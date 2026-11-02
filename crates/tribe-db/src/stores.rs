//! Shops found on OpenStreetMap, remembered so a busy map server does not
//! leave a trip with no stores at all.

use rusqlite::{Connection, Row, params};
use serde::Serialize;
use tribe_core::geo::{Bounds, LatLng};

use crate::ids::StoreId;
use crate::{DbResult, collect_rows, unix_now};

/// A shop as OpenStreetMap describes it.
#[derive(Debug, Clone, Serialize)]
pub struct OsmStore {
    /// `node/123` or `way/456`, for linking to openstreetmap.org.
    pub osm_ref: String,
    /// Name.
    pub name: String,
    /// The OpenStreetMap `shop` value, such as `supermarket`.
    pub shop_tag: String,
    /// Where it is; written as `lat` and `lng` in JSON.
    #[serde(flatten)]
    pub location: LatLng,
    /// Street address, when the map has one.
    pub address: String,
    /// Opening hours in OpenStreetMap's format, when the map has them.
    pub opening_hours: String,
}

/// A remembered shop.
#[derive(Debug, Clone, Serialize)]
pub struct Store {
    /// Database id.
    pub id: StoreId,
    /// What OpenStreetMap says about it; its fields sit beside `id` in JSON.
    #[serde(flatten)]
    pub osm: OsmStore,
}

fn read_store(row: &Row<'_>) -> rusqlite::Result<Store> {
    let osm = OsmStore {
        osm_ref: row.get(1)?,
        name: row.get(2)?,
        shop_tag: row.get(3)?,
        location: LatLng {
            lat: row.get(4)?,
            lng: row.get(5)?,
        },
        address: row.get(6)?,
        opening_hours: row.get(7)?,
    };
    Ok(Store {
        id: row.get(0)?,
        osm,
    })
}

/// Remembered shops inside `area` whose kind is one of `shop_tags`.
pub fn within(connection: &Connection, area: Bounds, shop_tags: &[String]) -> DbResult<Vec<Store>> {
    let mut statement = connection.prepare(
        "SELECT id, osm_ref, name, shop_tag, lat, lng, address, opening_hours FROM stores
         WHERE lat BETWEEN ?1 AND ?3 AND lng BETWEEN ?2 AND ?4
         LIMIT 2000",
    )?;
    let found = collect_rows(statement.query_map(
        params![area.south, area.west, area.north, area.east],
        read_store,
    )?)?;

    let wanted = found
        .into_iter()
        .filter(|store| shop_tags.contains(&store.osm.shop_tag))
        .collect();
    Ok(wanted)
}

/// Inserts or refreshes shops, and returns them with their database ids.
/// A shop seen again keeps its id.
pub fn upsert(connection: &mut Connection, found: &[OsmStore]) -> DbResult<Vec<Store>> {
    let now = unix_now();
    let transaction = connection.transaction()?;
    let mut stored = Vec::with_capacity(found.len());

    {
        let mut statement = transaction.prepare(
            "INSERT INTO stores (id, osm_ref, name, shop_tag, lat, lng, address, opening_hours, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT (osm_ref) DO UPDATE SET
               name = excluded.name, shop_tag = excluded.shop_tag, lat = excluded.lat, lng = excluded.lng,
               address = excluded.address, opening_hours = excluded.opening_hours, updated_at = excluded.updated_at
             RETURNING id",
        )?;

        for osm in found {
            let values = params![
                StoreId::random(),
                osm.osm_ref,
                osm.name,
                osm.shop_tag,
                osm.location.lat,
                osm.location.lng,
                osm.address,
                osm.opening_hours,
                now
            ];
            let id: StoreId = statement.query_row(values, |row| row.get(0))?;
            stored.push(Store {
                id,
                osm: osm.clone(),
            });
        }
    }

    transaction.commit()?;
    Ok(stored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;

    fn mercantile(name: &str) -> OsmStore {
        OsmStore {
            osm_ref: "node/1".to_string(),
            name: name.to_string(),
            shop_tag: "convenience".to_string(),
            location: LatLng {
                lat: 46.76,
                lng: -122.03,
            },
            address: String::new(),
            opening_hours: String::new(),
        }
    }

    #[test]
    fn a_shop_seen_again_keeps_its_id() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;

        let first = upsert(&mut connection, &[mercantile("Ashford Mercantile")])?;
        let second = upsert(&mut connection, &[mercantile("Ashford Mercantile & Deli")])?;

        assert_eq!(first[0].id, second[0].id);
        assert_eq!(second[0].osm.name, "Ashford Mercantile & Deli");
        Ok(())
    }

    #[test]
    fn within_filters_by_area_and_kind() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        upsert(&mut connection, &[mercantile("Ashford Mercantile")])?;

        let ashford = Bounds {
            west: -123.0,
            south: 46.0,
            east: -122.0,
            north: 47.0,
        };
        let north_of_it = Bounds {
            west: -123.0,
            south: 47.0,
            east: -122.0,
            north: 48.0,
        };
        let convenience = vec!["convenience".to_string()];

        assert_eq!(within(&connection, ashford, &convenience)?.len(), 1);
        assert!(within(&connection, north_of_it, &convenience)?.is_empty());
        assert!(within(&connection, ashford, &["outdoor".to_string()])?.is_empty());
        Ok(())
    }
}
