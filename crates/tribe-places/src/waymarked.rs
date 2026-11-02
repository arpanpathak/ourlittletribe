//! Marked hiking routes from Waymarked Trails, which serves OpenStreetMap's
//! route relations with their ways already in walking order. It answers in
//! about a second where the public Overpass servers are often too busy.
//! Its coordinates are Web Mercator metres (EPSG:3857).

use serde::Deserialize;
use serde_json::Value;
use tribe_core::geo::{Bounds, LatLng};
use tribe_core::trails::Segment;

use crate::trails::{Difficulty, FoundTrail};
use crate::{Places, PlacesError};

/// Half the side of a Web Mercator square, metres.
const MERCATOR_HALF: f64 = 20_037_508.34;

/// Earth's radius in the Web Mercator projection, metres.
const MERCATOR_RADIUS: f64 = 6_378_137.0;

/// Most routes listed for one area.
const MOST_LISTED: u32 = 20;

/// Most routes whose details are fetched.
const MOST_DETAILED: usize = 8;

#[derive(Deserialize)]
struct RouteList {
    results: Vec<ListedRoute>,
}

#[derive(Deserialize)]
struct ListedRoute {
    id: u64,
}

/// A point as Web Mercator metres.
fn to_mercator(point: LatLng) -> (f64, f64) {
    let x = point.lng * MERCATOR_HALF / 180.0;
    let y = ((90.0 + point.lat) * std::f64::consts::PI / 360.0)
        .tan()
        .ln()
        * MERCATOR_RADIUS;

    (x, y)
}

/// Web Mercator metres as a point.
fn from_mercator(x: f64, y: f64) -> LatLng {
    let lng = x * 180.0 / MERCATOR_HALF;
    let lat = (2.0 * (y / MERCATOR_RADIUS).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees();

    LatLng { lat, lng }
}

/// The area as the API wants it: west, south, east, north in Web Mercator metres.
fn mercator_bbox(bounds: Bounds) -> String {
    let (west, south) = to_mercator(LatLng {
        lat: bounds.south,
        lng: bounds.west,
    });
    let (east, north) = to_mercator(LatLng {
        lat: bounds.north,
        lng: bounds.east,
    });

    format!("{west:.0},{south:.0},{east:.0},{north:.0}")
}

/// Every `route_type: "base"` object under `value`, in document order: the
/// route's ways, whatever nesting of linear and split sections holds them.
fn base_ways(value: &Value, found: &mut Vec<Value>) {
    match value {
        Value::Object(fields)
            if fields.get("route_type").and_then(Value::as_str) == Some("base") =>
        {
            found.push(value.clone())
        }
        Value::Object(fields) => fields.values().for_each(|child| base_ways(child, found)),
        Value::Array(items) => items.iter().for_each(|child| base_ways(child, found)),
        _ => {}
    }
}

/// A way's line, from its GeoJSON `LineString` in Web Mercator.
fn way_line(way: &Value) -> Segment {
    let coordinates = way
        .pointer("/geometry/coordinates")
        .and_then(Value::as_array);
    let pairs = coordinates
        .into_iter()
        .flatten()
        .filter_map(Value::as_array);

    pairs
        .filter_map(|pair| {
            Some(from_mercator(
                pair.first()?.as_f64()?,
                pair.get(1)?.as_f64()?,
            ))
        })
        .collect()
}

/// The ways joined end to end into one line, each turned round if that
/// makes it start where the line so far ends.
fn stitched(lines: Vec<Segment>) -> Segment {
    let mut joined: Segment = Vec::new();

    for mut line in lines {
        let (Some(last), Some(first), Some(end)) = (
            joined.last().copied(),
            line.first().copied(),
            line.last().copied(),
        ) else {
            joined.extend(line);
            continue;
        };

        let to_first = tribe_core::geo::haversine_km(last, first);
        let to_end = tribe_core::geo::haversine_km(last, end);
        if to_end < to_first {
            line.reverse();
        }
        joined.extend(line);
    }
    joined
}

/// The hardest `sac_scale` grade on any way, if any way has one.
fn hardest(ways: &[Value]) -> Option<Difficulty> {
    let grades = ways
        .iter()
        .filter_map(|way| way.pointer("/tags/sac_scale").and_then(Value::as_str));

    grades.filter_map(Difficulty::from_sac_scale).max()
}

/// A route's details as a trail, or `None` without a name or a line.
fn read_route(id: u64, details: &Value) -> Option<FoundTrail> {
    let name = details
        .get("name")
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if name.is_empty() {
        return None;
    }

    let mut ways = Vec::new();
    if let Some(main) = details.pointer("/route/main") {
        base_ways(main, &mut ways);
    }

    let line = stitched(ways.iter().map(way_line).collect());
    if line.len() < 2 {
        return None;
    }

    let difficulty = hardest(&ways);
    Some(FoundTrail {
        osm_ref: format!("relation/{id}"),
        name,
        difficulty,
        is_route: true,
        segments: vec![line],
    })
}

impl Places {
    /// Marked hiking routes crossing `bounds`, with their lines in walking order.
    pub(crate) async fn waymarked_routes(
        &self,
        bounds: Bounds,
    ) -> Result<Vec<FoundTrail>, PlacesError> {
        let list_url = format!("{}/list/by_area", self.endpoints.waymarked);
        let request = self.http.get(&list_url).query(&[
            ("bbox", mercator_bbox(bounds)),
            ("limit", MOST_LISTED.to_string()),
        ]);
        let listed: RouteList = self.get_json("Waymarked Trails", request).await?;

        let mut routes = Vec::new();
        for route in listed.results.iter().take(MOST_DETAILED) {
            let detail_url = format!("{}/details/relation/{}", self.endpoints.waymarked, route.id);
            let details: Value = match self
                .get_json("Waymarked Trails", self.http.get(&detail_url))
                .await
            {
                Ok(details) => details,
                Err(error) => {
                    tracing::warn!(%error, route = route.id, "route details failed");
                    continue;
                }
            };

            if let Some(trail) = read_route(route.id, &details) {
                routes.push(trail);
            }
        }
        Ok(routes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mercator_round_trips() {
        let paradise = LatLng {
            lat: 46.786,
            lng: -121.735,
        };
        let (x, y) = to_mercator(paradise);
        let back = from_mercator(x, y);

        assert!((back.lat - paradise.lat).abs() < 1e-9);
        assert!((back.lng - paradise.lng).abs() < 1e-9);
    }

    #[test]
    fn ways_are_stitched_end_to_end() {
        let a = LatLng {
            lat: 46.0,
            lng: -121.0,
        };
        let b = LatLng {
            lat: 46.01,
            lng: -121.0,
        };
        let c = LatLng {
            lat: 46.02,
            lng: -121.0,
        };

        assert_eq!(stitched(vec![vec![a, b], vec![c, b]]), vec![a, b, b, c]);
    }

    #[test]
    fn a_route_reads_its_ways_in_order_and_its_hardest_grade() {
        let (x1, y1) = to_mercator(LatLng {
            lat: 46.78,
            lng: -121.74,
        });
        let (x2, y2) = to_mercator(LatLng {
            lat: 46.79,
            lng: -121.73,
        });
        let details = serde_json::json!({
            "name": "Skyline Trail",
            "route": { "main": [{ "route_type": "linear", "ways": [
                { "route_type": "base", "tags": { "sac_scale": "hiking" }, "geometry": { "type": "LineString", "coordinates": [[x1, y1], [x2, y2]] } },
                { "route_type": "base", "tags": { "sac_scale": "mountain_hiking" }, "geometry": { "type": "LineString", "coordinates": [[x2, y2], [x1, y2]] } }
            ]}]}
        });

        let trail = read_route(5_199_914, &details).unwrap();
        assert_eq!(trail.osm_ref, "relation/5199914");
        assert_eq!(trail.difficulty, Some(Difficulty::Moderate));
        assert_eq!(trail.segments[0].len(), 4);
    }
}
