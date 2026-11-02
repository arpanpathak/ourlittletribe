//! The numbers a hiker wants about a trail, from its line on the map and the
//! ground under it: how long it is, how much it climbs, and its profile.

use serde::Serialize;

use crate::geo::{LatLng, haversine_km, thin_route};

/// One drawn piece of a trail. A trail made of several OpenStreetMap ways
/// has several pieces, in no particular order.
pub type Segment = Vec<LatLng>;

/// How much a trail goes up and down, metres.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Climb {
    /// Total height gained going along the profile.
    pub gain_m: f64,
    /// Total height lost going along the profile.
    pub loss_m: f64,
    /// The lowest point.
    pub lowest_m: f64,
    /// The highest point.
    pub highest_m: f64,
}

/// Changes in height smaller than this are noise in the elevation data, metres.
const NOISE_M: f64 = 2.0;

/// The length of a line, km.
fn line_km(line: &[LatLng]) -> f64 {
    line.windows(2)
        .map(|pair| haversine_km(pair[0], pair[1]))
        .sum()
}

/// The total length of every piece, km.
pub fn length_km(segments: &[Segment]) -> f64 {
    segments.iter().map(|segment| line_km(segment)).sum()
}

/// Up to `count` points spread along the longest piece, where most trails
/// keep most of their length; enough to draw an elevation profile.
pub fn profile_points(segments: &[Segment], count: usize) -> Vec<LatLng> {
    let longest = segments
        .iter()
        .max_by(|first, second| line_km(first).total_cmp(&line_km(second)));

    match longest {
        Some(segment) => thin_route(segment, count),
        None => Vec::new(),
    }
}

/// The climb along a profile of heights in order, or `None` for an empty one.
pub fn climb(heights: &[f64]) -> Option<Climb> {
    let (&first, rest) = heights.split_first()?;

    let mut gain_m = 0.0;
    let mut loss_m = 0.0;
    let mut level = first;
    for &height in rest {
        let change = height - level;
        if change.abs() < NOISE_M {
            continue;
        }

        if change > 0.0 {
            gain_m += change;
        } else {
            loss_m -= change;
        }
        level = height;
    }

    let lowest_m = heights.iter().copied().fold(f64::INFINITY, f64::min);
    let highest_m = heights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    Some(Climb {
        gain_m,
        loss_m,
        lowest_m,
        highest_m,
    })
}

/// How far `point` is from the nearest point of any piece, km.
pub fn distance_to_km(point: LatLng, segments: &[Segment]) -> f64 {
    let all = segments.iter().flatten();

    all.map(|corner| haversine_km(point, *corner))
        .fold(f64::INFINITY, f64::min)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(lat: f64, lng: f64) -> LatLng {
        LatLng { lat, lng }
    }

    #[test]
    fn small_wobbles_are_not_climbing() {
        let found = climb(&[100.0, 101.0, 100.5, 130.0, 120.0, 121.0]).unwrap();

        assert_eq!(found.gain_m, 30.0);
        assert_eq!(found.loss_m, 10.0);
        assert_eq!(found.lowest_m, 100.0);
        assert_eq!(found.highest_m, 130.0);
    }

    #[test]
    fn an_empty_profile_has_no_climb() {
        assert!(climb(&[]).is_none());
    }

    #[test]
    fn length_adds_every_piece() {
        let piece = vec![point(46.78, -121.74), point(46.79, -121.74)];
        let one = length_km(std::slice::from_ref(&piece));

        assert!((one - 1.11).abs() < 0.02);
        assert!((length_km(&[piece.clone(), piece]) - 2.0 * one).abs() < 1e-9);
    }

    #[test]
    fn the_profile_follows_the_longest_piece() {
        let short = vec![point(46.0, -121.0), point(46.001, -121.0)];
        let long = vec![
            point(47.0, -121.0),
            point(47.05, -121.0),
            point(47.1, -121.0),
        ];

        assert_eq!(profile_points(&[short, long.clone()], 10), long);
    }
}
