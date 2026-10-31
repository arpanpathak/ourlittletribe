//! Stores found on OpenStreetMap, cached so the map can show them without asking again.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::{DbResult, new_id, unix_now};

/// A store as read from OpenStreetMap.
#[derive(Debug, Clone)]
pub struct OsmStore {
    /// `node/123` or `way/456`.
    pub osm_ref: String,
    /// Name.
    pub name: String,
    /// The OpenStreetMap `shop` value, such as `supermarket`.
    pub shop_tag: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
    /// Street address, when the map has one.
    pub address: String,
    /// The OpenStreetMap `opening_hours` value, when the map has one.
    pub opening_hours: String,
}

/// A cached store.
#[derive(Debug, Clone, Serialize)]
pub struct Store {
    /// Database id.
    pub id: String,
    /// `node/123` or `way/456`, for linking to openstreetmap.org.
    pub osm_ref: String,
    /// Name.
    pub name: String,
    /// The OpenStreetMap `shop` value.
    pub shop_tag: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
    /// Street address.
    pub address: String,
    /// Opening hours in OpenStreetMap's format.
    pub opening_hours: String,
}

/// Cached stores inside a box whose `shop` value is one of `shop_tags`; used when OpenStreetMap can't be asked.
pub fn within(
    connection: &Connection,
    south: f64,
    west: f64,
    north: f64,
    east: f64,
    shop_tags: &[String],
) -> DbResult<Vec<Store>> {
    let mut statement = connection.prepare(
        "SELECT id, osm_ref, name, shop_tag, lat, lng, address, opening_hours FROM stores
         WHERE lat BETWEEN ?1 AND ?3 AND lng BETWEEN ?2 AND ?4
         LIMIT 2000",
    )?;
    let found = statement
        .query_map(params![south, west, north, east], |row| {
            Ok(Store {
                id: row.get(0)?,
                osm_ref: row.get(1)?,
                name: row.get(2)?,
                shop_tag: row.get(3)?,
                lat: row.get(4)?,
                lng: row.get(5)?,
                address: row.get(6)?,
                opening_hours: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(found.into_iter().filter(|store| shop_tags.contains(&store.shop_tag)).collect())
}

/// Inserts or refreshes stores, and returns them with their database ids.
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
        for store in found {
            let id: String = statement.query_row(
                params![
                    new_id(),
                    store.osm_ref,
                    store.name,
                    store.shop_tag,
                    store.lat,
                    store.lng,
                    store.address,
                    store.opening_hours,
                    now
                ],
                |row| row.get(0),
            )?;
            stored.push(Store {
                id,
                osm_ref: store.osm_ref.clone(),
                name: store.name.clone(),
                shop_tag: store.shop_tag.clone(),
                lat: store.lat,
                lng: store.lng,
                address: store.address.clone(),
                opening_hours: store.opening_hours.clone(),
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

    #[test]
    fn upsert_keeps_id_for_same_osm_ref() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let mut store = OsmStore {
            osm_ref: "node/1".to_string(),
            name: "Ashford Mercantile".to_string(),
            shop_tag: "convenience".to_string(),
            lat: 46.76,
            lng: -122.03,
            address: String::new(),
            opening_hours: String::new(),
        };
        let first = upsert(&mut connection, std::slice::from_ref(&store))?;
        store.name = "Ashford Mercantile & Deli".to_string();
        let second = upsert(&mut connection, std::slice::from_ref(&store))?;
        let (Some(first), Some(second)) = (first.first(), second.first()) else {
            panic!("nothing stored");
        };
        assert_eq!(first.id, second.id);
        assert_eq!(second.name, "Ashford Mercantile & Deli");
        let tags = vec!["convenience".to_string()];
        assert_eq!(within(&connection, 46.0, -123.0, 47.0, -122.0, &tags)?.len(), 1);
        assert!(within(&connection, 47.0, -123.0, 48.0, -122.0, &tags)?.is_empty());
        assert!(within(&connection, 46.0, -123.0, 47.0, -122.0, &["outdoor".to_string()])?.is_empty());
        Ok(())
    }
}
