//! Place search and reverse lookup from Photon, an OpenStreetMap geocoder
//! built for search-as-you-type.

use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;

use crate::{Places, PlacesError};

/// A place found by a search or a reverse lookup.
#[derive(Debug, Clone, Serialize)]
pub struct PlaceMatch {
    /// A short name for the place, such as "Paradise Inn" or "52807 Paradise Road East".
    pub name: String,
    /// Where it is, such as "Ashford, WA, United States".
    pub detail: String,
    /// What kind of place it is, from OpenStreetMap, such as `hotel` or `peak`.
    pub kind: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
}

#[derive(Deserialize)]
struct FeatureCollection {
    features: Vec<Feature>,
}

#[derive(Deserialize)]
struct Feature {
    geometry: Geometry,
    properties: Properties,
}

#[derive(Deserialize)]
struct Geometry {
    coordinates: [f64; 2],
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Properties {
    name: Option<String>,
    housenumber: Option<String>,
    street: Option<String>,
    district: Option<String>,
    city: Option<String>,
    county: Option<String>,
    state: Option<String>,
    country: Option<String>,
    osm_value: Option<String>,
}

fn non_empty(text: &Option<String>) -> Option<&str> {
    text.as_deref().map(str::trim).filter(|value| !value.is_empty())
}

impl Feature {
    fn into_place(self) -> Option<PlaceMatch> {
        let [lng, lat] = self.geometry.coordinates;
        let point = LatLng::new(lat, lng)?;
        let properties = &self.properties;
        let street_address = match (non_empty(&properties.housenumber), non_empty(&properties.street)) {
            (Some(number), Some(street)) => Some(format!("{number} {street}")),
            (None, Some(street)) => Some(street.to_string()),
            _ => None,
        };
        let name = match (non_empty(&properties.name), &street_address) {
            (Some(name), _) => name.to_string(),
            (None, Some(address)) => address.clone(),
            (None, None) => non_empty(&properties.city)
                .or(non_empty(&properties.district))
                .or(non_empty(&properties.county))
                .or(non_empty(&properties.state))?
                .to_string(),
        };
        let town = non_empty(&properties.city)
            .or(non_empty(&properties.district))
            .or(non_empty(&properties.county));
        let mut parts: Vec<&str> = Vec::new();
        if non_empty(&properties.name).is_some()
            && let Some(address) = &street_address
        {
            parts.push(address);
        }
        for part in [town, non_empty(&properties.state), non_empty(&properties.country)].into_iter().flatten() {
            if part != name && !parts.contains(&part) {
                parts.push(part);
            }
        }
        Some(PlaceMatch {
            detail: parts.join(", "),
            kind: properties.osm_value.clone().unwrap_or_default().replace('_', " "),
            name,
            lat: point.lat,
            lng: point.lng,
        })
    }
}

impl Places {
    /// Up to `limit` places matching `query`, preferring ones near `near` when given.
    pub async fn search_places(&self, query: &str, near: Option<LatLng>, limit: u8) -> Result<Vec<PlaceMatch>, PlacesError> {
        let mut parameters = vec![("q", query.to_string()), ("limit", limit.to_string()), ("lang", "en".to_string())];
        if let Some(center) = near {
            parameters.push(("lat", center.lat.to_string()));
            parameters.push(("lon", center.lng.to_string()));
        }
        let request = self.http.get(format!("{}/api/", self.endpoints.photon)).query(&parameters);
        let found: FeatureCollection = self.get_json("Photon", request).await?;
        Ok(found.features.into_iter().filter_map(Feature::into_place).collect())
    }

    /// The nearest named place or address to `point`, if any.
    pub async fn place_at(&self, point: LatLng) -> Result<Option<PlaceMatch>, PlacesError> {
        let parameters = [
            ("lat", point.lat.to_string()),
            ("lon", point.lng.to_string()),
            ("limit", "1".to_string()),
            ("lang", "en".to_string()),
        ];
        let request = self.http.get(format!("{}/reverse", self.endpoints.photon)).query(&parameters);
        let found: FeatureCollection = self.get_json("Photon", request).await?;
        Ok(found.features.into_iter().find_map(Feature::into_place))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Vec<PlaceMatch> {
        let collection: FeatureCollection = match serde_json::from_str(json) {
            Ok(collection) => collection,
            Err(error) => panic!("bad sample: {error}"),
        };
        collection.features.into_iter().filter_map(Feature::into_place).collect()
    }

    #[test]
    fn named_place_keeps_its_address_in_the_detail() {
        let places = parse(
            r#"{"features":[{"geometry":{"coordinates":[-121.7339,46.7868]},"properties":{"name":"Paradise Inn",
            "housenumber":"52807","street":"Paradise Road East","city":"Ashford","state":"WA","country":"United States","osm_value":"hotel"}}]}"#,
        );
        assert_eq!(places.len(), 1);
        assert_eq!(places[0].name, "Paradise Inn");
        assert_eq!(places[0].detail, "52807 Paradise Road East, Ashford, WA, United States");
        assert_eq!(places[0].kind, "hotel");
    }

    #[test]
    fn unnamed_house_is_named_by_its_address() {
        let places = parse(
            r#"{"features":[{"geometry":{"coordinates":[-121.7354,46.7864]},"properties":{"housenumber":"52419",
            "street":"Paradise Road East","district":"Paradise","city":"Ashford","state":"WA","country":"United States"}}]}"#,
        );
        assert_eq!(places[0].name, "52419 Paradise Road East");
        assert_eq!(places[0].detail, "Ashford, WA, United States");
    }

    #[test]
    fn a_town_is_not_repeated_in_its_own_detail() {
        let places = parse(
            r#"{"features":[{"geometry":{"coordinates":[-122.33,47.6]},"properties":{"name":"Seattle","city":"Seattle",
            "state":"Washington","country":"United States","osm_value":"city"}}]}"#,
        );
        assert_eq!(places[0].detail, "Washington, United States");
    }

    #[test]
    fn points_off_the_map_are_dropped() {
        let places = parse(r#"{"features":[{"geometry":{"coordinates":[500.0,91.0]},"properties":{"name":"Nowhere"}}]}"#);
        assert!(places.is_empty());
    }
}
