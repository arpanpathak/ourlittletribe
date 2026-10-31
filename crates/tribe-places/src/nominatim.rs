//! Place search from OpenStreetMap's Nominatim.

use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;

use crate::{Places, PlacesError};

/// A place matching a search.
#[derive(Debug, Clone, Serialize)]
pub struct PlaceMatch {
    /// The full name Nominatim gives, such as "Paradise, Pierce County, Washington, United States".
    pub name: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
}

#[derive(Deserialize)]
struct SearchHit {
    display_name: String,
    lat: String,
    lon: String,
}

impl Places {
    /// Up to `limit` places matching `query`, preferring ones near `near` when given.
    pub async fn search_places(&self, query: &str, near: Option<LatLng>, limit: u8) -> Result<Vec<PlaceMatch>, PlacesError> {
        let mut parameters = vec![
            ("q", query.to_string()),
            ("format", "jsonv2".to_string()),
            ("limit", limit.to_string()),
        ];
        if let Some(center) = near {
            let viewbox = format!(
                "{},{},{},{}",
                center.lng - 1.0,
                center.lat + 1.0,
                center.lng + 1.0,
                center.lat - 1.0
            );
            parameters.push(("viewbox", viewbox));
        }
        let request = self
            .http
            .get(format!("{}/search", self.endpoints.nominatim))
            .query(&parameters);
        let hits: Vec<SearchHit> = self.get_json("Nominatim", request).await?;
        let mut places = Vec::with_capacity(hits.len());
        for hit in hits {
            if let (Ok(lat), Ok(lng)) = (hit.lat.parse::<f64>(), hit.lon.parse::<f64>()) {
                places.push(PlaceMatch { name: hit.display_name, lat, lng });
            }
        }
        Ok(places)
    }
}
