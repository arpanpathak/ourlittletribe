//! Place search and reverse lookup from Nominatim, OpenStreetMap's own
//! geocoder. Used when Photon is down or refuses; requests are spaced a
//! second apart, as Nominatim's usage policy asks.

use serde::Deserialize;
use tribe_core::geo::LatLng;

use crate::photon::{Bounds, PlaceMatch};
use crate::{NOMINATIM_SPACING, Places, PlacesError};

/// How far around the searcher counts as nearby, in degrees each way (about 150 km).
const NEARBY_HALF_DEGREES: f64 = 1.5;

#[derive(Deserialize)]
struct Found {
    lat: String,
    lon: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_name: String,
    #[serde(default, rename = "type")]
    kind: String,
    /// South, north, west, east.
    #[serde(default)]
    boundingbox: Vec<String>,
    #[serde(default)]
    address: Address,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Address {
    house_number: Option<String>,
    road: Option<String>,
    city: Option<String>,
    town: Option<String>,
    village: Option<String>,
    hamlet: Option<String>,
    county: Option<String>,
    state: Option<String>,
    country: Option<String>,
}

impl Found {
    fn into_place(self) -> Option<(PlaceMatch, Option<Bounds>)> {
        let point = LatLng::new(self.lat.parse().ok()?, self.lon.parse().ok()?)?;
        let address = &self.address;
        let street = match (&address.house_number, &address.road) {
            (Some(number), Some(road)) => Some(format!("{number} {road}")),
            (None, Some(road)) => Some(road.clone()),
            _ => None,
        };
        let first_part = self
            .display_name
            .split(',')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        let name = match (self.name.trim(), &street) {
            ("", Some(street)) => street.clone(),
            ("", None) => first_part,
            (name, _) => name.to_string(),
        };
        if name.is_empty() {
            return None;
        }
        let town = [
            &address.city,
            &address.town,
            &address.village,
            &address.hamlet,
            &address.county,
        ]
        .into_iter()
        .find_map(|part| part.as_deref());
        let mut parts: Vec<&str> = Vec::new();
        if let Some(street) = &street
            && *street != name
        {
            parts.push(street);
        }
        for part in [town, address.state.as_deref(), address.country.as_deref()]
            .into_iter()
            .flatten()
        {
            if part != name && !parts.contains(&part) {
                parts.push(part);
            }
        }
        let bounds = match self.boundingbox.as_slice() {
            [south, north, west, east] => {
                match (south.parse(), north.parse(), west.parse(), east.parse()) {
                    (Ok(south), Ok(north), Ok(west), Ok(east)) => Some(Bounds {
                        west,
                        south,
                        east,
                        north,
                    }),
                    _ => None,
                }
            }
            _ => None,
        };
        let place = PlaceMatch {
            name,
            detail: parts.join(", "),
            kind: self.kind.replace('_', " "),
            lat: point.lat,
            lng: point.lng,
        };
        Some((place, bounds))
    }
}

impl Places {
    /// Waits for Nominatim's turn, then sends the request.
    async fn nominatim_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<T, PlacesError> {
        let mut last_sent = self.nominatim_turn.lock().await;
        if let Some(sent) = *last_sent {
            let since = sent.elapsed();
            if since < NOMINATIM_SPACING {
                tokio::time::sleep(NOMINATIM_SPACING - since).await;
            }
        }
        *last_sent = Some(std::time::Instant::now());
        let request = self
            .http
            .get(format!("{}/{path}", self.endpoints.nominatim))
            .query(parameters)
            .query(&[
                ("format", "jsonv2"),
                ("addressdetails", "1"),
                ("accept-language", "en"),
            ]);
        self.get_json("Nominatim", request).await
    }

    /// Places matching `query`, each with its bounding box. `within`, when
    /// given, is a hard limit; otherwise places near `near` are tried first,
    /// then anywhere.
    pub(crate) async fn nominatim_search(
        &self,
        query: &str,
        near: Option<LatLng>,
        within: Option<Bounds>,
        limit: u8,
    ) -> Result<Vec<(PlaceMatch, Option<Bounds>)>, PlacesError> {
        let bounded =
            within.or_else(|| near.map(|point| Bounds::around(point, NEARBY_HALF_DEGREES)));
        if let Some(view) = bounded {
            let parameters = [
                ("q", query.to_string()),
                ("limit", limit.to_string()),
                (
                    "viewbox",
                    format!("{},{},{},{}", view.west, view.north, view.east, view.south),
                ),
                ("bounded", "1".to_string()),
            ];
            let found: Vec<Found> = self.nominatim_json("search", &parameters).await?;
            if !found.is_empty() || within.is_some() {
                return Ok(found.into_iter().filter_map(Found::into_place).collect());
            }
        }
        let parameters = [("q", query.to_string()), ("limit", limit.to_string())];
        let found: Vec<Found> = self.nominatim_json("search", &parameters).await?;
        Ok(found.into_iter().filter_map(Found::into_place).collect())
    }

    /// The nearest named place or address to `point`.
    pub(crate) async fn nominatim_reverse(
        &self,
        point: LatLng,
    ) -> Result<Option<PlaceMatch>, PlacesError> {
        let parameters = [
            ("lat", point.lat.to_string()),
            ("lon", point.lng.to_string()),
            ("zoom", "18".to_string()),
        ];
        let found: Found = match self.nominatim_json("reverse", &parameters).await {
            Ok(found) => found,
            // Nominatim answers `{"error": …}` for points with nothing near, such as open sea.
            Err(PlacesError::Http { .. }) => return Ok(None),
            Err(error) => return Err(error),
        };
        Ok(found.into_place().map(|(place, _)| place))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_result_becomes_a_place_with_its_box() {
        let found: Found = match serde_json::from_str(
            r#"{"lat":"46.78","lon":"-121.73","name":"Jackson Visitor Center","type":"office",
            "display_name":"Jackson Visitor Center, 52415, Paradise Road, Paradise, Pierce County, Washington, United States",
            "boundingbox":["46.7859","46.7862","-121.7357","-121.7353"],
            "address":{"house_number":"52415","road":"Paradise Road","county":"Pierce County","state":"Washington","country":"United States"}}"#,
        ) {
            Ok(found) => found,
            Err(error) => panic!("bad sample: {error}"),
        };
        let Some((place, Some(bounds))) = found.into_place() else {
            panic!("no place");
        };
        assert_eq!(place.name, "Jackson Visitor Center");
        assert_eq!(
            place.detail,
            "52415 Paradise Road, Pierce County, Washington, United States"
        );
        assert!(bounds.south < bounds.north && bounds.west < bounds.east);
    }
}
