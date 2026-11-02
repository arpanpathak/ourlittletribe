//! Distances on the earth and the extra driving a stop adds to a trip.
//!
//! Without a road network these are estimates: straight-line distance times
//! a road factor. The server replaces them with routed times when the
//! routing service answers, and the app labels which one it shows.

use serde::{Deserialize, Serialize};

const EARTH_RADIUS_KM: f64 = 6371.0;

/// Roads are longer than straight lines; this is the usual ratio in towns and suburbs.
pub const ROAD_FACTOR: f64 = 1.35;

/// Average speed assumed for an estimated detour.
pub const ESTIMATE_SPEED_KMH: f64 = 45.0;

/// A point given as latitude and longitude in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LatLng {
    /// Latitude, -90 to 90.
    pub lat: f64,
    /// Longitude, -180 to 180.
    pub lng: f64,
}

impl LatLng {
    /// Builds a point, or `None` if either coordinate is out of range or not a number.
    pub fn new(lat: f64, lng: f64) -> Option<LatLng> {
        let lat_ok = lat.is_finite() && (-90.0..=90.0).contains(&lat);
        let lng_ok = lng.is_finite() && (-180.0..=180.0).contains(&lng);
        match lat_ok && lng_ok {
            true => Some(LatLng { lat, lng }),
            false => None,
        }
    }
}

/// A box on the map, in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
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

    /// The same box grown by `fraction` of its size on every side, and at least
    /// `minimum_degrees` across in each direction.
    pub fn padded(self, fraction: f64, minimum_degrees: f64) -> Bounds {
        let pad_x = padding(self.east - self.west, fraction, minimum_degrees);
        let pad_y = padding(self.north - self.south, fraction, minimum_degrees);

        Bounds {
            west: self.west - pad_x,
            south: self.south - pad_y,
            east: self.east + pad_x,
            north: self.north + pad_y,
        }
    }

    /// Whether `point` is inside the box, edges included.
    pub fn contains(self, point: LatLng) -> bool {
        let inside_lat = (self.south..=self.north).contains(&point.lat);
        let inside_lng = (self.west..=self.east).contains(&point.lng);
        inside_lat && inside_lng
    }
}

/// How much to add on each side of a span: `fraction` of it, or enough to make
/// it `minimum` wide, whichever is more.
fn padding(span: f64, fraction: f64, minimum: f64) -> f64 {
    let by_fraction = span * fraction;
    let to_minimum = (minimum - span) / 2.0;
    by_fraction.max(to_minimum).max(0.0)
}

/// Great-circle distance between two points, in kilometres.
pub fn haversine_km(from: LatLng, to: LatLng) -> f64 {
    let from_lat = from.lat.to_radians();
    let to_lat = to.lat.to_radians();
    let delta_lat = (to.lat - from.lat).to_radians();
    let delta_lng = (to.lng - from.lng).to_radians();
    let half_chord = (delta_lat / 2.0).sin().powi(2)
        + from_lat.cos() * to_lat.cos() * (delta_lng / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * half_chord.sqrt().asin()
}

/// Distance in kilometres from `point` to the closest place on the segment `start`–`end`.
///
/// Uses a flat projection centred on the segment, which is accurate to well
/// under one percent for the few tens of kilometres a trip covers.
pub fn distance_to_segment_km(point: LatLng, start: LatLng, end: LatLng) -> f64 {
    let km_per_deg_lat = EARTH_RADIUS_KM.to_radians();
    let km_per_deg_lng = km_per_deg_lat * ((start.lat + end.lat) / 2.0).to_radians().cos();
    let to_xy = |p: LatLng| (p.lng * km_per_deg_lng, p.lat * km_per_deg_lat);
    let (px, py) = to_xy(point);
    let (ax, ay) = to_xy(start);
    let (bx, by) = to_xy(end);
    let (abx, aby) = (bx - ax, by - ay);
    let length_squared = abx * abx + aby * aby;
    let along = match length_squared > f64::EPSILON {
        true => (((px - ax) * abx + (py - ay) * aby) / length_squared).clamp(0.0, 1.0),
        false => 0.0,
    };
    let (cx, cy) = (ax + along * abx, ay + along * aby);
    ((px - cx).powi(2) + (py - cy).powi(2)).sqrt()
}

/// Distance in kilometres from `point` to the nearest part of a route drawn as a line through `route`.
///
/// A route of one point is treated as that point; an empty route gives infinity.
pub fn distance_to_route_km(point: LatLng, route: &[LatLng]) -> f64 {
    match route {
        [] => f64::INFINITY,
        [only] => haversine_km(point, *only),
        _ => {
            let mut nearest = f64::INFINITY;
            for pair in route.windows(2) {
                if let [start, end] = pair {
                    nearest = nearest.min(distance_to_segment_km(point, *start, *end));
                }
            }
            nearest
        }
    }
}

/// Estimated extra driving minutes to leave the route, reach `point` and come back.
pub fn estimated_detour_minutes(point: LatLng, route: &[LatLng]) -> f64 {
    let off_route_km = distance_to_route_km(point, route);
    let extra_road_km = 2.0 * off_route_km * ROAD_FACTOR;
    extra_road_km / ESTIMATE_SPEED_KMH * 60.0
}

/// Keeps at most `max_points` points of a route, always including the first and last.
///
/// Used to shorten a routed polyline before sending it to services with URL limits.
pub fn thin_route(route: &[LatLng], max_points: usize) -> Vec<LatLng> {
    if route.len() <= max_points || max_points < 2 {
        return route.to_vec();
    }
    let step = (route.len() - 1) as f64 / (max_points - 1) as f64;
    let mut thinned = Vec::with_capacity(max_points);
    for slot in 0..max_points {
        let source = (slot as f64 * step).round() as usize;
        if let Some(point) = route.get(source.min(route.len() - 1)) {
            thinned.push(*point);
        }
    }
    thinned
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(lat: f64, lng: f64) -> LatLng {
        LatLng { lat, lng }
    }

    #[test]
    fn seattle_to_paradise_is_about_100_km() {
        let seattle = point(47.6062, -122.3321);
        let paradise = point(46.7865, -121.7353);
        let distance = haversine_km(seattle, paradise);
        assert!((95.0..105.0).contains(&distance), "{distance}");
    }

    #[test]
    fn invalid_coordinates_are_rejected() {
        assert!(LatLng::new(91.0, 0.0).is_none());
        assert!(LatLng::new(0.0, f64::NAN).is_none());
        assert!(LatLng::new(47.0, -122.0).is_some());
    }

    #[test]
    fn point_on_the_route_has_no_detour() {
        let route = [point(47.0, -122.0), point(47.0, -121.0)];
        let on_route = point(47.0, -121.5);
        assert!(estimated_detour_minutes(on_route, &route) < 0.01);
    }

    #[test]
    fn detour_grows_with_distance_from_route() {
        let route = [point(47.0, -122.0), point(47.0, -121.0)];
        let near = point(47.01, -121.5);
        let far = point(47.10, -121.5);
        let near_minutes = estimated_detour_minutes(near, &route);
        let far_minutes = estimated_detour_minutes(far, &route);
        assert!(near_minutes < far_minutes);
        assert!((1.0..5.0).contains(&near_minutes), "{near_minutes}");
    }

    #[test]
    fn point_beyond_segment_end_measures_to_the_end() {
        let start = point(47.0, -122.0);
        let end = point(47.0, -121.0);
        let beyond = point(47.0, -120.9);
        let to_segment = distance_to_segment_km(beyond, start, end);
        let to_end = haversine_km(beyond, end);
        assert!((to_segment - to_end).abs() < 0.1);
    }

    #[test]
    fn thinning_keeps_both_ends() {
        let route: Vec<LatLng> = (0..100)
            .map(|step| point(47.0, -122.0 + step as f64 * 0.01))
            .collect();
        let thinned = thin_route(&route, 10);
        assert_eq!(thinned.len(), 10);
        assert_eq!(thinned.first(), route.first());
        assert_eq!(thinned.last(), route.last());
    }
}
