//! Stores near a route, from OpenStreetMap through Overpass.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use tribe_core::geo::{LatLng, thin_route};
use tribe_core::osm::is_plain_tag;

use crate::{Places, PlacesError};

/// A named shop found on the map.
#[derive(Debug, Clone)]
pub struct FoundStore {
    /// `node/123` or `way/456`.
    pub osm_ref: String,
    /// Name.
    pub name: String,
    /// The `shop` value.
    pub shop_tag: String,
    /// Where it is.
    pub location: LatLng,
    /// Street address, when tagged.
    pub address: String,
    /// `opening_hours`, when tagged.
    pub opening_hours: String,
}

#[derive(Deserialize)]
struct OverpassResponse {
    #[serde(default)]
    elements: Vec<Element>,
}

#[derive(Deserialize)]
struct Element {
    #[serde(rename = "type")]
    kind: String,
    id: u64,
    lat: Option<f64>,
    lon: Option<f64>,
    center: Option<Center>,
    #[serde(default)]
    tags: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct Center {
    lat: f64,
    lon: f64,
}

fn build_query(route: &[LatLng], radius_m: u32, shop_tags: &[String], limit: u32) -> String {
    let mut line = Vec::with_capacity(route.len() * 2);
    for point in route {
        line.push(format!("{:.5}", point.lat));
        line.push(format!("{:.5}", point.lng));
    }
    let around = format!("around:{radius_m},{}", line.join(","));
    let tag_pattern = shop_tags.join("|");
    format!(
        "[out:json][timeout:25];(node[\"shop\"~\"^({tag_pattern})$\"][\"name\"]({around});way[\"shop\"~\"^({tag_pattern})$\"][\"name\"]({around}););out center {limit};"
    )
}

fn street_address(tags: &std::collections::BTreeMap<String, String>) -> String {
    let number = tags
        .get("addr:housenumber")
        .map(String::as_str)
        .unwrap_or("");
    let street = tags.get("addr:street").map(String::as_str).unwrap_or("");
    let city = tags.get("addr:city").map(String::as_str).unwrap_or("");
    let first_line = format!("{number} {street}").trim().to_string();
    match (first_line.is_empty(), city.is_empty()) {
        (true, true) => String::new(),
        (true, false) => city.to_string(),
        (false, true) => first_line,
        (false, false) => format!("{first_line}, {city}"),
    }
}

fn read_element(element: Element) -> Option<FoundStore> {
    let location = match (element.lat, element.lon, element.center) {
        (Some(lat), Some(lng), _) => LatLng { lat, lng },
        (_, _, Some(center)) => LatLng {
            lat: center.lat,
            lng: center.lon,
        },
        _ => return None,
    };
    let name = element.tags.get("name")?.clone();
    let shop_tag = element.tags.get("shop")?.clone();
    Some(FoundStore {
        osm_ref: format!("{}/{}", element.kind, element.id),
        address: street_address(&element.tags),
        opening_hours: element
            .tags
            .get("opening_hours")
            .cloned()
            .unwrap_or_default(),
        name,
        shop_tag,
        location,
    })
}

/// How long to wait for one Overpass server before trying the next.
const OVERPASS_ATTEMPT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

impl Places {
    /// Sends `query` to each configured Overpass server in turn and returns
    /// the first answer, or the last server's error.
    pub(crate) async fn ask_overpass<Answer: DeserializeOwned>(
        &self,
        query: &str,
    ) -> Result<Answer, PlacesError> {
        let mut last_error = PlacesError::Refused {
            service: "Overpass",
            reason: "no Overpass server is configured".to_string(),
        };

        for interpreter in &self.endpoints.overpass {
            let request = self
                .http
                .post(interpreter)
                .timeout(OVERPASS_ATTEMPT_TIMEOUT)
                .form(&[("data", query)]);

            match self.get_json::<Answer>("Overpass", request).await {
                Ok(answer) => return Ok(answer),
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    /// Named shops whose `shop` value is one of `shop_tags`, within `radius_m` metres of `route`.
    ///
    /// Tags that are not plain lower-case words are dropped before querying.
    pub async fn stores_along(
        &self,
        route: &[LatLng],
        radius_m: u32,
        shop_tags: &[String],
    ) -> Result<Vec<FoundStore>, PlacesError> {
        let mut safe_tags = Vec::new();
        for tag in shop_tags {
            if is_plain_tag(tag) && !safe_tags.contains(tag) {
                safe_tags.push(tag.clone());
            }
        }
        if safe_tags.is_empty() || route.is_empty() {
            return Ok(Vec::new());
        }

        let query = build_query(&thin_route(route, 60), radius_m, &safe_tags, 300);
        let response: OverpassResponse = self.ask_overpass(&query).await?;

        Ok(response
            .elements
            .into_iter()
            .filter_map(read_element)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_uses_route_and_tags() {
        let route = [
            LatLng {
                lat: 47.6,
                lng: -122.3,
            },
            LatLng {
                lat: 46.8,
                lng: -121.7,
            },
        ];
        let tags = vec!["supermarket".to_string(), "outdoor".to_string()];
        let query = build_query(&route, 2000, &tags, 50);
        assert!(query.contains("around:2000,47.60000,-122.30000,46.80000,-121.70000"));
        assert!(query.contains("^(supermarket|outdoor)$"));
    }

    #[test]
    fn way_uses_its_center_and_address_is_joined() -> Result<(), serde_json::Error> {
        let body = r#"{"elements":[{"type":"way","id":7,"center":{"lat":46.75,"lon":-121.98},
            "tags":{"name":"Whittaker's","shop":"outdoor","addr:housenumber":"30205","addr:street":"SR 706 E","addr:city":"Ashford"}},
            {"type":"node","id":8,"lat":1.0,"lon":2.0,"tags":{"shop":"bakery"}}]}"#;
        let response: OverpassResponse = serde_json::from_str(body)?;
        let stores: Vec<FoundStore> = response
            .elements
            .into_iter()
            .filter_map(read_element)
            .collect();
        assert_eq!(stores.len(), 1);
        let Some(store) = stores.first() else {
            panic!("no store");
        };
        assert_eq!(store.osm_ref, "way/7");
        assert_eq!(store.address, "30205 SR 706 E, Ashford");
        Ok(())
    }
}
