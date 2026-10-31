//! Place search and reverse lookup from Photon, an OpenStreetMap geocoder
//! built for search-as-you-type. When Photon fails, each lookup is answered
//! by Nominatim instead (see `nominatim`), and Photon rests for two minutes.

use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tribe_core::geo::{Bounds, LatLng};

use crate::address::{Address, PlaceMatch, clean};
use crate::nominatim::Found;
use crate::{Places, PlacesError};

/// A named area, such as a park or a town, with a box around it.
#[derive(Debug, Clone, PartialEq)]
pub struct Area {
    /// The area itself.
    pub place: PlaceMatch,
    /// Its outline, padded, or a box around its point when it has no outline.
    pub bounds: Bounds,
}

/// After Photon fails, how long to go straight to Nominatim.
const PHOTON_REST_SECONDS: u64 = 120;

/// How long to wait for Photon before asking Nominatim instead.
const PHOTON_TIMEOUT: Duration = Duration::from_secs(6);

/// How far around a point-like area, such as a peak, to look for places in it.
const POINT_AREA_HALF_DEGREES: f64 = 0.2;

/// How much to grow an area's outline on each side, as a share of its size.
const OUTLINE_PADDING: f64 = 0.15;

/// OpenStreetMap kinds that describe an area people say a place is "in".
const AREA_TAGS: [&str; 6] = [
    "place",
    "boundary",
    "natural",
    "leisure:park",
    "leisure:nature_reserve",
    "landuse",
];

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
    /// Longitude, then latitude.
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

impl Properties {
    fn address(&self) -> Address {
        let town = clean(self.city.as_deref())
            .or_else(|| clean(self.district.as_deref()))
            .or_else(|| clean(self.county.as_deref()));

        Address {
            name: clean(self.name.as_deref()),
            house_number: clean(self.housenumber.as_deref()),
            street: clean(self.street.as_deref()),
            town,
            state: clean(self.state.as_deref()),
            country: clean(self.country.as_deref()),
        }
    }

    fn outline(&self) -> Option<Bounds> {
        let [west, north, east, south] = self.extent?;
        Some(Bounds {
            west,
            south,
            east,
            north,
        })
    }
}

impl Feature {
    fn location(&self) -> Option<LatLng> {
        let [lng, lat] = self.geometry.coordinates;
        LatLng::new(lat, lng)
    }

    fn into_place(self) -> Option<PlaceMatch> {
        let location = self.location()?;
        let kind = self.properties.osm_value.clone().unwrap_or_default();
        self.properties.address().into_match(location, &kind)
    }

    fn into_area(self) -> Option<Area> {
        let outline = self.properties.outline();
        let place = self.into_place()?;
        let bounds = area_bounds(outline, place.location);
        Some(Area { place, bounds })
    }
}

/// The box to search inside an area: its outline grown a little, or a box around its point.
pub(crate) fn area_bounds(outline: Option<Bounds>, center: LatLng) -> Bounds {
    match outline {
        Some(outline) => outline.padded(OUTLINE_PADDING, 2.0 * POINT_AREA_HALF_DEGREES),
        None => Bounds::around(center, POINT_AREA_HALF_DEGREES),
    }
}

/// A box as Photon's `bbox` parameter: west, south, east, north.
fn bbox_parameter(bounds: Bounds) -> String {
    format!(
        "{:.5},{:.5},{:.5},{:.5}",
        bounds.west, bounds.south, bounds.east, bounds.north
    )
}

/// The query parameters every Photon search starts with.
fn search_parameters(query: &str, limit: u8, near: Option<LatLng>) -> Vec<(&'static str, String)> {
    let mut parameters = vec![
        ("q", query.to_string()),
        ("limit", limit.to_string()),
        ("lang", "en".to_string()),
    ];

    if let Some(center) = near {
        parameters.push(("lat", center.lat.to_string()));
        parameters.push(("lon", center.lng.to_string()));
    }
    parameters
}

fn now_seconds() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_secs(),
        Err(_) => 0,
    }
}

fn places_of(features: Vec<Feature>) -> Vec<PlaceMatch> {
    features
        .into_iter()
        .filter_map(Feature::into_place)
        .collect()
}

fn places_of_found(found: Vec<Found>) -> Vec<PlaceMatch> {
    found.into_iter().map(|found| found.place).collect()
}

impl Places {
    /// Asks Photon, unless it failed in the last two minutes; a failure starts that rest.
    async fn photon(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<Vec<Feature>, PlacesError> {
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

    /// One Photon request, at most three at a time.
    async fn photon_request(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<Vec<Feature>, PlacesError> {
        let Ok(_slot) = self.photon_slots.acquire().await else {
            return Err(PlacesError::Refused {
                service: "Photon",
                reason: "shutting down".to_string(),
            });
        };

        let request = self
            .http
            .get(format!("{}/{path}", self.endpoints.photon))
            .query(parameters)
            .timeout(PHOTON_TIMEOUT);
        let found: FeatureCollection = self.get_json("Photon", request).await?;
        Ok(found.features)
    }

    /// The area best matching `query`, such as a park, town or mountain, with a box around it.
    pub async fn find_area(
        &self,
        query: &str,
        near: Option<LatLng>,
    ) -> Result<Option<Area>, PlacesError> {
        let mut parameters = search_parameters(query, 3, near);
        for tag in AREA_TAGS {
            parameters.push(("osm_tag", tag.to_string()));
        }

        match self.photon("api/", &parameters).await {
            Ok(features) => Ok(features.into_iter().next().and_then(Feature::into_area)),
            Err(_) => self.nominatim_area(query, near).await,
        }
    }

    async fn nominatim_area(
        &self,
        query: &str,
        near: Option<LatLng>,
    ) -> Result<Option<Area>, PlacesError> {
        let found = self.nominatim_search(query, near, None, 1).await?;
        let Some(first) = found.into_iter().next() else {
            return Ok(None);
        };

        let bounds = area_bounds(first.outline, first.place.location);
        Ok(Some(Area {
            place: first.place,
            bounds,
        }))
    }

    /// Up to `limit` places matching `query` inside `bounds`.
    pub async fn search_within(
        &self,
        query: &str,
        bounds: Bounds,
        limit: u8,
    ) -> Result<Vec<PlaceMatch>, PlacesError> {
        let mut parameters = search_parameters(query, limit, None);
        parameters.push(("bbox", bbox_parameter(bounds)));

        match self.photon("api/", &parameters).await {
            Ok(features) => Ok(places_of(features)),
            Err(_) => Ok(places_of_found(
                self.nominatim_search(query, None, Some(bounds), limit)
                    .await?,
            )),
        }
    }

    /// Up to `limit` places matching `query`, preferring ones near `near`.
    pub async fn search_places(
        &self,
        query: &str,
        near: Option<LatLng>,
        limit: u8,
    ) -> Result<Vec<PlaceMatch>, PlacesError> {
        let parameters = search_parameters(query, limit, near);

        match self.photon("api/", &parameters).await {
            Ok(features) => Ok(places_of(features)),
            Err(_) => Ok(places_of_found(
                self.nominatim_search(query, near, None, limit).await?,
            )),
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

        match self.photon("reverse", &parameters).await {
            Ok(features) => Ok(features.into_iter().find_map(Feature::into_place)),
            Err(_) => self.nominatim_reverse(point).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Vec<Feature> {
        match serde_json::from_str::<FeatureCollection>(json) {
            Ok(collection) => collection.features,
            Err(error) => panic!("bad sample: {error}"),
        }
    }

    #[test]
    fn a_feature_becomes_a_place_with_its_address() {
        let features = parse(
            r#"{"features":[{"geometry":{"coordinates":[-121.7339,46.7868]},"properties":{"name":"Paradise Inn",
            "housenumber":"52807","street":"Paradise Road East","city":"Ashford","state":"WA","country":"United States","osm_value":"hotel"}}]}"#,
        );
        let places = places_of(features);

        assert_eq!(places.len(), 1);
        assert_eq!(places[0].name, "Paradise Inn");
        assert_eq!(
            places[0].detail,
            "52807 Paradise Road East, Ashford, WA, United States"
        );
        assert_eq!(places[0].kind, "hotel");
    }

    #[test]
    fn an_area_uses_its_padded_outline() {
        let features = parse(
            r#"{"features":[{"geometry":{"coordinates":[-121.75,46.85]},"properties":{"name":"Mount Rainier National Park",
            "extent":[-122.0,47.0,-121.5,46.7],"osm_value":"nature_reserve"}}]}"#,
        );
        let Some(area) = features.into_iter().next().and_then(Feature::into_area) else {
            panic!("no area");
        };

        assert!(area.bounds.west < -122.0 && area.bounds.east > -121.5);
        assert!(area.bounds.contains(LatLng {
            lat: 46.786,
            lng: -121.735
        }));
    }

    #[test]
    fn points_off_the_map_are_dropped() {
        let features = parse(
            r#"{"features":[{"geometry":{"coordinates":[500.0,91.0]},"properties":{"name":"Nowhere"}}]}"#,
        );
        assert!(places_of(features).is_empty());
    }
}
