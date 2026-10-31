//! Driving routes and detour times from OSRM.

use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;

use crate::{Places, PlacesError};

/// A driving route.
#[derive(Debug, Clone, Serialize)]
pub struct Route {
    /// The route's shape, start to end.
    pub points: Vec<LatLng>,
    /// Driving time, minutes.
    pub duration_minutes: f64,
    /// Length, kilometres.
    pub distance_km: f64,
}

#[derive(Deserialize)]
struct RouteResponse {
    code: String,
    #[serde(default)]
    routes: Vec<RouteBody>,
}

#[derive(Deserialize)]
struct RouteBody {
    duration: f64,
    distance: f64,
    geometry: Geometry,
}

#[derive(Deserialize)]
struct Geometry {
    coordinates: Vec<[f64; 2]>,
}

#[derive(Deserialize)]
struct TableResponse {
    code: String,
    #[serde(default)]
    durations: Vec<Vec<Option<f64>>>,
}

fn coordinate_list(points: &[LatLng]) -> String {
    let mut parts = Vec::with_capacity(points.len());
    for point in points {
        parts.push(format!("{:.6},{:.6}", point.lng, point.lat));
    }
    parts.join(";")
}

fn index_list(range: std::ops::Range<usize>) -> String {
    let mut parts = Vec::with_capacity(range.len());
    for index in range {
        parts.push(index.to_string());
    }
    parts.join(";")
}

/// Turns an OSRM duration table into extra minutes per stop.
///
/// Row 0 is the origin and rows 1.. are the stops; column 0 is the
/// destination and columns 1.. are the stops again.
fn detours_from_table(durations: &[Vec<Option<f64>>], stop_count: usize, direct_seconds: f64) -> Vec<Option<f64>> {
    let mut detours = Vec::with_capacity(stop_count);
    for stop in 1..=stop_count {
        let origin_to_stop = durations.first().and_then(|row| row.get(stop).copied().flatten());
        let stop_to_destination = durations.get(stop).and_then(|row| row.first().copied().flatten());
        let detour = match (origin_to_stop, stop_to_destination) {
            (Some(there), Some(onward)) => Some(((there + onward - direct_seconds) / 60.0).max(0.0)),
            _ => None,
        };
        detours.push(detour);
    }
    detours
}

impl Places {
    /// The fastest driving route from `from` to `to`.
    pub async fn route(&self, from: LatLng, to: LatLng) -> Result<Route, PlacesError> {
        let url = format!(
            "{}/route/v1/driving/{}",
            self.endpoints.osrm,
            coordinate_list(&[from, to])
        );
        let request = self
            .http
            .get(url)
            .query(&[("overview", "simplified"), ("geometries", "geojson")]);
        let response: RouteResponse = self.get_json("OSRM", request).await?;
        let Some(best) = response.routes.into_iter().next() else {
            return Err(PlacesError::Refused { service: "OSRM", reason: response.code });
        };
        let mut points = Vec::with_capacity(best.geometry.coordinates.len());
        for [lng, lat] in best.geometry.coordinates {
            points.push(LatLng { lat, lng });
        }
        Ok(Route {
            points,
            duration_minutes: best.duration / 60.0,
            distance_km: best.distance / 1000.0,
        })
    }

    /// Extra driving minutes to stop at each of `stops` on the way from `origin` to
    /// `destination`, in the same order. `None` where OSRM found no road.
    pub async fn detour_minutes(
        &self,
        origin: LatLng,
        destination: LatLng,
        direct_minutes: f64,
        stops: &[LatLng],
    ) -> Result<Vec<Option<f64>>, PlacesError> {
        if stops.is_empty() {
            return Ok(Vec::new());
        }
        let mut coordinates = vec![origin, destination];
        coordinates.extend_from_slice(stops);
        let url = format!(
            "{}/table/v1/driving/{}",
            self.endpoints.osrm,
            coordinate_list(&coordinates)
        );
        let sources = format!("0;{}", index_list(2..coordinates.len()));
        let destinations = format!("1;{}", index_list(2..coordinates.len()));
        let request = self
            .http
            .get(url)
            .query(&[("sources", sources), ("destinations", destinations)]);
        let response: TableResponse = self.get_json("OSRM table", request).await?;
        if response.code != "Ok" {
            return Err(PlacesError::Refused { service: "OSRM table", reason: response.code });
        }
        Ok(detours_from_table(&response.durations, stops.len(), direct_minutes * 60.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_rows_become_detours() {
        let durations = vec![
            vec![Some(3600.0), Some(600.0), Some(1200.0)],
            vec![Some(3100.0), None, None],
            vec![None, None, None],
        ];
        let detours = detours_from_table(&durations, 2, 3600.0);
        let Some(Some(first)) = detours.first().copied() else {
            panic!("first detour missing");
        };
        assert!((first - 1.666_666).abs() < 0.01);
        assert_eq!(detours.get(1).copied(), Some(None));
    }

    #[test]
    fn coordinates_are_longitude_first() {
        let text = coordinate_list(&[LatLng { lat: 47.5, lng: -122.25 }]);
        assert_eq!(text, "-122.250000,47.500000");
    }
}
