//! Shops of one kind inside an area, from Nominatim. Used when Overpass,
//! the usual store search, is too busy to answer. Nominatim reads phrases
//! such as "outdoor shop" as the OpenStreetMap tag `shop=outdoor`, so a
//! search for the phrase inside the area returns real shops of that kind.

use std::collections::HashMap;

use serde::Deserialize;
use tribe_core::geo::{Bounds, LatLng};

use crate::nominatim::viewbox_parameter;
use crate::overpass::FoundStore;
use crate::{Places, PlacesError};

/// Most shops of one kind asked for.
const MOST_SHOPS: u8 = 20;

/// One result as Nominatim's JSON has it, with the fields a shop needs.
#[derive(Deserialize)]
struct ShopResult {
    lat: String,
    lon: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    category: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    osm_type: String,
    #[serde(default)]
    osm_id: u64,
    #[serde(default)]
    address: HashMap<String, String>,
    #[serde(default)]
    extratags: Option<HashMap<String, String>>,
}

/// What to ask Nominatim for one kind of shop, such as "outdoor shop" for `outdoor`.
fn phrase_for(kind: &str) -> String {
    format!("{} shop", kind.replace('_', " "))
}

/// The street address, such as "4011 Factoria Square Mall Southeast, Bellevue".
fn street_address(address: &HashMap<String, String>) -> String {
    let street = [address.get("house_number"), address.get("road")]
        .into_iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    let town = ["city", "town", "village"]
        .iter()
        .find_map(|key| address.get(*key))
        .cloned()
        .unwrap_or_default();

    [street, town]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

/// A shop from one result, or `None` when it is not a named shop of `kind`.
fn read_shop(result: ShopResult, kind: &str) -> Option<FoundStore> {
    let is_kind = result.category == "shop" && result.kind == kind;
    if !is_kind || result.name.trim().is_empty() {
        return None;
    }

    let lat: f64 = result.lat.parse().ok()?;
    let lng: f64 = result.lon.parse().ok()?;
    let opening_hours = result
        .extratags
        .as_ref()
        .and_then(|tags| tags.get("opening_hours"))
        .cloned()
        .unwrap_or_default();

    Some(FoundStore {
        osm_ref: format!("{}/{}", result.osm_type, result.osm_id),
        name: result.name.trim().to_string(),
        shop_tag: kind.to_string(),
        location: LatLng { lat, lng },
        address: street_address(&result.address),
        opening_hours,
    })
}

impl Places {
    /// Named shops of `kind` (an OpenStreetMap `shop` value, such as
    /// "outdoor") inside `area`, from Nominatim.
    pub async fn shops_by_kind(
        &self,
        area: Bounds,
        kind: &str,
    ) -> Result<Vec<FoundStore>, PlacesError> {
        let parameters = [
            ("q", phrase_for(kind)),
            ("viewbox", viewbox_parameter(area)),
            ("bounded", "1".to_string()),
            ("limit", MOST_SHOPS.to_string()),
            ("extratags", "1".to_string()),
        ];
        let results: Vec<ShopResult> = self.nominatim_json("search", &parameters).await?;

        Ok(results
            .into_iter()
            .filter_map(|result| read_shop(result, kind))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[
        {"lat":"47.578","lon":"-122.170","name":"REI","category":"shop","type":"outdoor","osm_type":"node","osm_id":12,
         "address":{"house_number":"4011","road":"Factoria Square Mall Southeast","city":"Bellevue"},
         "extratags":{"opening_hours":"Mo-Sa 10:00-21:00"}},
        {"lat":"47.5","lon":"-122.1","name":"Outdoor Kitchen","category":"amenity","type":"restaurant","osm_type":"node","osm_id":13},
        {"lat":"47.5","lon":"-122.1","name":"","category":"shop","type":"outdoor","osm_type":"node","osm_id":14}
    ]"#;

    #[test]
    fn only_named_shops_of_the_kind_are_kept() {
        let results: Vec<ShopResult> = serde_json::from_str(SAMPLE).unwrap();
        let shops: Vec<FoundStore> = results
            .into_iter()
            .filter_map(|result| read_shop(result, "outdoor"))
            .collect();

        assert_eq!(shops.len(), 1);
        assert_eq!(shops[0].osm_ref, "node/12");
        assert_eq!(
            shops[0].address,
            "4011 Factoria Square Mall Southeast, Bellevue"
        );
        assert_eq!(shops[0].opening_hours, "Mo-Sa 10:00-21:00");
    }

    #[test]
    fn a_kind_becomes_its_phrase() {
        assert_eq!(phrase_for("outdoor"), "outdoor shop");
        assert_eq!(phrase_for("doityourself"), "doityourself shop");
        assert_eq!(phrase_for("sports_nutrition"), "sports nutrition shop");
    }
}
