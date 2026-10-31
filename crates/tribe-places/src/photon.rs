//! Place search and reverse lookup from Photon, an OpenStreetMap geocoder
//! built for search-as-you-type. When Photon fails, each lookup is answered
//! by Nominatim instead (see `nominatim`).

use std::time::Duration;

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
    /// West, north, east, south; only areas have one.
    extent: Option<[f64; 4]>,
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
    text.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

impl Feature {
    fn into_place(self) -> Option<PlaceMatch> {
        let [lng, lat] = self.geometry.coordinates;
        let point = LatLng::new(lat, lng)?;
        let properties = &self.properties;
        let street_address = match (
            non_empty(&properties.housenumber),
            non_empty(&properties.street),
        ) {
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
        for part in [
            town,
            non_empty(&properties.state),
            non_empty(&properties.country),
        ]
        .into_iter()
        .flatten()
        {
            if part != name && !parts.contains(&part) {
                parts.push(part);
            }
        }
        Some(PlaceMatch {
            detail: parts.join(", "),
            kind: properties
                .osm_value
                .clone()
                .unwrap_or_default()
                .replace('_', " "),
            name,
            lat: point.lat,
            lng: point.lng,
        })
    }
}

/// A box on the map.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    /// Westmost longitude.
    pub west: f64,
    /// Southmost latitude.
    pub south: f64,
    /// Eastmost longitude.
    pub east: f64,
    /// Northmost latitude.
    pub north: f64,
}

impl Bounds {
    /// A box reaching `half_degrees` out from `point` each way.
    pub fn around(point: LatLng, half_degrees: f64) -> Bounds {
        Bounds {
            west: point.lng - half_degrees,
            south: point.lat - half_degrees,
            east: point.lng + half_degrees,
            north: point.lat + half_degrees,
        }
    }

    /// The same box grown by `fraction` of its size on every side, and at least `minimum_degrees` across.
    pub fn padded(self, fraction: f64, minimum_degrees: f64) -> Bounds {
        let pad_x = ((self.east - self.west) * fraction)
            .max((minimum_degrees - (self.east - self.west)) / 2.0)
            .max(0.0);
        let pad_y = ((self.north - self.south) * fraction)
            .max((minimum_degrees - (self.north - self.south)) / 2.0)
            .max(0.0);
        Bounds {
            west: self.west - pad_x,
            south: self.south - pad_y,
            east: self.east + pad_x,
            north: self.north + pad_y,
        }
    }

    fn as_parameter(self) -> String {
        format!(
            "{:.5},{:.5},{:.5},{:.5}",
            self.west, self.south, self.east, self.north
        )
    }
}

/// After Photon fails, how long to go straight to Nominatim.
const PHOTON_REST_SECONDS: u64 = 120;

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// How long to wait for Photon before asking Nominatim instead.
const PHOTON_TIMEOUT: Duration = Duration::from_secs(6);

/// How far around a point-like area (a peak, a village with no outline) to look for places in it.
const POINT_AREA_HALF_DEGREES: f64 = 0.2;

/// OpenStreetMap kinds that describe an area people say a place is "in": towns, parks, peaks, regions.
const AREA_TAGS: [&str; 6] = [
    "place",
    "boundary",
    "natural",
    "leisure:park",
    "leisure:nature_reserve",
    "landuse",
];

impl Places {
    async fn photon_get(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<Vec<Feature>, PlacesError> {
        use std::sync::atomic::Ordering;
        if self.photon_resting_until.load(Ordering::Relaxed) > now_seconds() {
            return Err(PlacesError::Refused {
                service: "Photon",
                reason: "failed recently; resting".to_string(),
            });
        }
        let answer = self.photon_request(path, parameters).await;
        if answer.is_err() {
            self.photon_resting_until
                .store(now_seconds() + PHOTON_REST_SECONDS, Ordering::Relaxed);
        }
        answer
    }

    async fn photon_request(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<Vec<Feature>, PlacesError> {
        let _slot = self
            .photon_slots
            .acquire()
            .await
            .map_err(|_| PlacesError::Refused {
                service: "Photon",
                reason: "shutting down".to_string(),
            })?;
        let request = self
            .http
            .get(format!("{}/{path}", self.endpoints.photon))
            .query(parameters)
            .timeout(PHOTON_TIMEOUT);
        let found: FeatureCollection = self.get_json("Photon", request).await?;
        Ok(found.features)
    }

    async fn photon_features(
        &self,
        parameters: &[(&str, String)],
    ) -> Result<Vec<Feature>, PlacesError> {
        self.photon_get("api/", parameters).await
    }

    /// The area best matching `query`, such as a park, town or mountain, with a box
    /// around it: its outline when OpenStreetMap has one, else a box around its point.
    pub async fn find_area(
        &self,
        query: &str,
        near: Option<LatLng>,
    ) -> Result<Option<(PlaceMatch, Bounds)>, PlacesError> {
        let mut parameters = vec![
            ("q", query.to_string()),
            ("limit", "3".to_string()),
            ("lang", "en".to_string()),
        ];
        for tag in AREA_TAGS {
            parameters.push(("osm_tag", tag.to_string()));
        }
        if let Some(center) = near {
            parameters.push(("lat", center.lat.to_string()));
            parameters.push(("lon", center.lng.to_string()));
        }
        let features = match self.photon_features(&parameters).await {
            Ok(features) => features,
            Err(_) => {
                let found = self.nominatim_search(query, near, None, 1).await?;
                return Ok(found.into_iter().next().map(|(place, bounds)| {
                    let point_box = LatLng::new(place.lat, place.lng)
                        .map(|point| Bounds::around(point, POINT_AREA_HALF_DEGREES));
                    let bounds = match bounds {
                        Some(outline) => outline.padded(0.15, 2.0 * POINT_AREA_HALF_DEGREES),
                        None => point_box.unwrap_or(Bounds {
                            west: -180.0,
                            south: -85.0,
                            east: 180.0,
                            north: 85.0,
                        }),
                    };
                    (place, bounds)
                }));
            }
        };
        let Some(feature) = features.into_iter().next() else {
            return Ok(None);
        };
        let extent = feature.properties.extent;
        let Some(place) = feature.into_place() else {
            return Ok(None);
        };
        let bounds = match extent {
            Some([west, north, east, south]) => Bounds {
                west,
                south,
                east,
                north,
            }
            .padded(0.15, 0.05),
            None => match LatLng::new(place.lat, place.lng) {
                Some(point) => Bounds::around(point, POINT_AREA_HALF_DEGREES),
                None => return Ok(None),
            },
        };
        Ok(Some((place, bounds)))
    }

    /// Up to `limit` places matching `query` inside `bounds`.
    pub async fn search_within(
        &self,
        query: &str,
        bounds: Bounds,
        limit: u8,
    ) -> Result<Vec<PlaceMatch>, PlacesError> {
        let parameters = [
            ("q", query.to_string()),
            ("limit", limit.to_string()),
            ("lang", "en".to_string()),
            ("bbox", bounds.as_parameter()),
        ];
        match self.photon_features(&parameters).await {
            Ok(features) => Ok(features
                .into_iter()
                .filter_map(Feature::into_place)
                .collect()),
            Err(_) => Ok(self
                .nominatim_search(query, None, Some(bounds), limit)
                .await?
                .into_iter()
                .map(|(place, _)| place)
                .collect()),
        }
    }

    /// Up to `limit` places matching `query`, preferring ones near `near` when given.
    pub async fn search_places(
        &self,
        query: &str,
        near: Option<LatLng>,
        limit: u8,
    ) -> Result<Vec<PlaceMatch>, PlacesError> {
        let mut parameters = vec![
            ("q", query.to_string()),
            ("limit", limit.to_string()),
            ("lang", "en".to_string()),
        ];
        if let Some(center) = near {
            parameters.push(("lat", center.lat.to_string()));
            parameters.push(("lon", center.lng.to_string()));
        }
        match self.photon_features(&parameters).await {
            Ok(features) => Ok(features
                .into_iter()
                .filter_map(Feature::into_place)
                .collect()),
            Err(_) => Ok(self
                .nominatim_search(query, near, None, limit)
                .await?
                .into_iter()
                .map(|(place, _)| place)
                .collect()),
        }
    }

    /// The nearest named place or address to `point`, if any.
    pub async fn place_at(&self, point: LatLng) -> Result<Option<PlaceMatch>, PlacesError> {
        let parameters = [
            ("lat", point.lat.to_string()),
            ("lon", point.lng.to_string()),
            ("limit", "1".to_string()),
            ("lang", "en".to_string()),
        ];
        match self.photon_get("reverse", &parameters).await {
            Ok(features) => Ok(features.into_iter().find_map(Feature::into_place)),
            Err(_) => self.nominatim_reverse(point).await,
        }
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
        collection
            .features
            .into_iter()
            .filter_map(Feature::into_place)
            .collect()
    }

    #[test]
    fn named_place_keeps_its_address_in_the_detail() {
        let places = parse(
            r#"{"features":[{"geometry":{"coordinates":[-121.7339,46.7868]},"properties":{"name":"Paradise Inn",
            "housenumber":"52807","street":"Paradise Road East","city":"Ashford","state":"WA","country":"United States","osm_value":"hotel"}}]}"#,
        );
        assert_eq!(places.len(), 1);
        assert_eq!(places[0].name, "Paradise Inn");
        assert_eq!(
            places[0].detail,
            "52807 Paradise Road East, Ashford, WA, United States"
        );
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
        let places = parse(
            r#"{"features":[{"geometry":{"coordinates":[500.0,91.0]},"properties":{"name":"Nowhere"}}]}"#,
        );
        assert!(places.is_empty());
    }
}
