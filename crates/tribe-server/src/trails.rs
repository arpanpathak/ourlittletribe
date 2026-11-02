//! Trails near where an event happens: OpenStreetMap's named hiking routes
//! and paths, nearest first, each measured with the ground under it.

use serde::Serialize;
use tokio::task::JoinSet;
use tribe_core::geo::LatLng;
use tribe_core::trails::{self, Climb, Segment};
use tribe_db::events::Event;
use tribe_places::trails::{Difficulty, FoundTrail};

use crate::conditions;
use crate::error::ApiResult;
use crate::state::AppState;

/// How far from the venue to look for trails, metres.
const SEARCH_RADIUS_M: u32 = 4000;

/// Most trails shown.
const MOST_SHOWN: usize = 6;

/// Points on each trail's elevation profile.
const PROFILE_POINTS: usize = 60;

/// A trail as the event page shows it.
#[derive(Debug, Clone, Serialize)]
pub struct TrailView {
    /// `relation/123` or `way/456`, for a link to OpenStreetMap.
    pub osm_ref: String,
    /// Its name.
    pub name: String,
    /// How hard it is, when the map says.
    pub difficulty: Option<Difficulty>,
    /// Whether it is a marked hiking route rather than one named path.
    pub is_route: bool,
    /// Its length, km.
    pub length_km: f64,
    /// Its climb, when the elevation lookup worked.
    pub climb: Option<Climb>,
    /// Heights along its longest piece, metres, in order.
    pub profile: Vec<f64>,
    /// Its line, in pieces.
    pub segments: Vec<Segment>,
    /// How far its nearest point is from where the event happens, km.
    pub distance_km: f64,
}

/// A trail with its length, climb and profile.
async fn measured(state: AppState, trail: FoundTrail, from: LatLng) -> TrailView {
    let points = trails::profile_points(&trail.segments, PROFILE_POINTS);
    let profile = state
        .places
        .elevations_m(&points)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "trail elevation lookup failed");
            Vec::new()
        });

    TrailView {
        length_km: trails::length_km(&trail.segments),
        climb: trails::climb(&profile),
        distance_km: trails::distance_to_km(from, &trail.segments),
        osm_ref: trail.osm_ref,
        name: trail.name,
        difficulty: trail.difficulty,
        is_route: trail.is_route,
        profile,
        segments: trail.segments,
    }
}

/// The nearest trails, measured all at once, nearest first.
async fn measure_nearest(state: &AppState, found: Vec<FoundTrail>, from: LatLng) -> Vec<TrailView> {
    let mut nearest = found;
    nearest.sort_by(|first, second| {
        let first_km = trails::distance_to_km(from, &first.segments);
        let second_km = trails::distance_to_km(from, &second.segments);
        first_km.total_cmp(&second_km)
    });
    nearest.truncate(MOST_SHOWN);

    let mut lookups = JoinSet::new();
    for (index, trail) in nearest.into_iter().enumerate() {
        let state = state.clone();
        lookups.spawn(async move { (index, measured(state, trail, from).await) });
    }

    let mut done = Vec::new();
    while let Some(Ok(result)) = lookups.join_next().await {
        done.push(result);
    }
    done.sort_by_key(|(index, _)| *index);

    done.into_iter().map(|(_, trail)| trail).collect()
}

/// Trails near where `event` happens, from a six-hour cache or from OpenStreetMap.
pub async fn near_event(state: &AppState, event: &Event) -> ApiResult<Vec<TrailView>> {
    if let Some(cached) = state.caches.trails.get(&event.id) {
        return Ok(cached);
    }

    let place = conditions::place_of(state, event).await;
    let found = state
        .places
        .trails_near(place.point, SEARCH_RADIUS_M)
        .await?;
    let measured = measure_nearest(state, found, place.point).await;

    state.caches.trails.put(event.id.clone(), measured.clone());
    Ok(measured)
}
