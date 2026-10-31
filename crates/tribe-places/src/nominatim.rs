//! Place search and reverse lookup from Nominatim, OpenStreetMap's own
//! geocoder. Used when Photon is down or refuses; requests are spaced a
//! second apart, as Nominatim's usage policy asks.

use std::time::Instant;

use serde::Deserialize;
use tribe_core::geo::{Bounds, LatLng};

use crate::address::{Address, PlaceMatch, clean};
use crate::{NOMINATIM_SPACING, Places, PlacesError};

/// How far around the searcher counts as nearby, in degrees each way (about 150 km).
const NEARBY_HALF_DEGREES: f64 = 1.5;

/// A place Nominatim found, with its outline when it has one.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Found {
    /// The place.
    pub place: PlaceMatch,
    /// Its bounding box as Nominatim gives it; a building's is tiny, a park's is its extent.
    pub outline: Option<Bounds>,
}

/// One result as Nominatim's JSON has it.
#[derive(Deserialize)]
struct NominatimPlace {
    lat: String,
    lon: String,
    #[serde(default)]
    name: String,
    /// The full comma-separated address, used when nothing else names the place.
    #[serde(default)]
    display_name: String,
    #[serde(default, rename = "type")]
    kind: String,
    /// South, north, west, east, as text.
    #[serde(default)]
    boundingbox: Vec<String>,
    #[serde(default)]
    address: NominatimAddress,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct NominatimAddress {
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

impl NominatimAddress {
    /// The most specific settlement named: city, town, village, hamlet, then county.
    fn town(&self) -> Option<String> {
        [
            &self.city,
            &self.town,
            &self.village,
            &self.hamlet,
            &self.county,
        ]
        .into_iter()
        .find_map(|part| clean(part.as_deref()))
    }
}

impl NominatimPlace {
    fn location(&self) -> Option<LatLng> {
        LatLng::new(self.lat.parse().ok()?, self.lon.parse().ok()?)
    }

    /// The first part of the full address, such as "Jackson Visitor Center".
    fn first_part_of_display_name(&self) -> Option<String> {
        clean(self.display_name.split(',').next())
    }

    fn address(&self) -> Address {
        let parts = &self.address;
        let street = clean(parts.road.as_deref());
        let name = clean(Some(&self.name)).or_else(|| match street {
            Some(_) => None,
            None => self.first_part_of_display_name(),
        });

        Address {
            name,
            house_number: clean(parts.house_number.as_deref()),
            street,
            town: parts.town(),
            state: clean(parts.state.as_deref()),
            country: clean(parts.country.as_deref()),
        }
    }

    fn outline(&self) -> Option<Bounds> {
        let [south, north, west, east] = self.boundingbox.as_slice() else {
            return None;
        };

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

    fn into_found(self) -> Option<Found> {
        let location = self.location()?;
        let outline = self.outline();
        let place = self.address().into_match(location, &self.kind)?;
        Some(Found { place, outline })
    }
}

/// A box as Nominatim's `viewbox` parameter: west, north, east, south.
fn viewbox_parameter(view: Bounds) -> String {
    format!("{},{},{},{}", view.west, view.north, view.east, view.south)
}

fn found_of(places: Vec<NominatimPlace>) -> Vec<Found> {
    places
        .into_iter()
        .filter_map(NominatimPlace::into_found)
        .collect()
}

impl Places {
    /// Waits for Nominatim's turn, a second after the last request, then asks.
    async fn nominatim_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        parameters: &[(&str, String)],
    ) -> Result<T, PlacesError> {
        let mut last_sent = self.nominatim_turn.lock().await;
        if let Some(sent) = *last_sent {
            let waited = sent.elapsed();
            if waited < NOMINATIM_SPACING {
                tokio::time::sleep(NOMINATIM_SPACING - waited).await;
            }
        }
        *last_sent = Some(Instant::now());

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

    /// Places matching `query` inside `view`; nothing outside it.
    async fn nominatim_bounded(
        &self,
        query: &str,
        view: Bounds,
        limit: u8,
    ) -> Result<Vec<Found>, PlacesError> {
        let parameters = [
            ("q", query.to_string()),
            ("limit", limit.to_string()),
            ("viewbox", viewbox_parameter(view)),
            ("bounded", "1".to_string()),
        ];
        let places: Vec<NominatimPlace> = self.nominatim_json("search", &parameters).await?;
        Ok(found_of(places))
    }

    /// Places matching `query` anywhere.
    async fn nominatim_anywhere(&self, query: &str, limit: u8) -> Result<Vec<Found>, PlacesError> {
        let parameters = [("q", query.to_string()), ("limit", limit.to_string())];
        let places: Vec<NominatimPlace> = self.nominatim_json("search", &parameters).await?;
        Ok(found_of(places))
    }

    /// Places matching `query`. Inside `within` only, when given; otherwise near
    /// `near` first, then anywhere if nothing nearby matches.
    pub(crate) async fn nominatim_search(
        &self,
        query: &str,
        near: Option<LatLng>,
        within: Option<Bounds>,
        limit: u8,
    ) -> Result<Vec<Found>, PlacesError> {
        if let Some(area) = within {
            return self.nominatim_bounded(query, area, limit).await;
        }

        if let Some(point) = near {
            let nearby = self
                .nominatim_bounded(query, Bounds::around(point, NEARBY_HALF_DEGREES), limit)
                .await?;
            if !nearby.is_empty() {
                return Ok(nearby);
            }
        }

        self.nominatim_anywhere(query, limit).await
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

        let place: NominatimPlace = match self.nominatim_json("reverse", &parameters).await {
            Ok(place) => place,
            Err(PlacesError::Http { .. }) => return Ok(None),
            Err(error) => return Err(error),
        };
        Ok(place.into_found().map(|found| found.place))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_result_becomes_a_place_with_its_outline() {
        let sample = r#"{"lat":"46.78","lon":"-121.73","name":"Jackson Visitor Center","type":"office",
            "display_name":"Jackson Visitor Center, 52415, Paradise Road, Paradise, Pierce County, Washington, United States",
            "boundingbox":["46.7859","46.7862","-121.7357","-121.7353"],
            "address":{"house_number":"52415","road":"Paradise Road","county":"Pierce County","state":"Washington","country":"United States"}}"#;
        let place: NominatimPlace = match serde_json::from_str(sample) {
            Ok(place) => place,
            Err(error) => panic!("bad sample: {error}"),
        };

        let Some(Found {
            place,
            outline: Some(outline),
        }) = place.into_found()
        else {
            panic!("no place");
        };
        assert_eq!(place.name, "Jackson Visitor Center");
        assert_eq!(
            place.detail,
            "52415 Paradise Road, Pierce County, Washington, United States"
        );
        assert!(outline.south < outline.north && outline.west < outline.east);
    }
}
