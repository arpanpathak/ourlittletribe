//! Puts the pieces together for one event: the real conditions, the facts
//! the model reads, and the stores along a person's way.

use serde::Serialize;
use tribe_brain::{DriveFacts, TripFacts, WeatherFacts};
use tribe_core::basket::{EvidenceThreshold, bought_with};
use tribe_core::clock::{format_local, format_local_clock};
use tribe_core::geo::{LatLng, estimated_detour_minutes};
use tribe_core::recommend::{NeededItem, RankingRules, StoreCandidate, rank_stores};
use tribe_db::events::Event;
use tribe_db::prep::{self, PrepItem};
use tribe_db::stores::{self, OsmStore, Store};
use tribe_places::osrm::Route;
use tribe_places::weather::DayForecast;

use crate::error::ApiResult;
use crate::state::AppState;

/// The forecast and elevation at an event's meeting point.
#[derive(Debug, Clone, Serialize)]
pub struct Conditions {
    /// Ground elevation, metres.
    pub elevation_m: Option<f64>,
    /// Forecast for the event's day, when within 16 days.
    pub forecast: Option<DayForecast>,
}

/// A store worth a stop, with why.
#[derive(Debug, Clone, Serialize)]
pub struct StoreStop {
    /// The store.
    pub store: Store,
    /// Extra driving minutes.
    pub detour_minutes: f64,
    /// `true` when the detour is estimated from straight-line distance.
    pub detour_is_estimate: bool,
    /// Needed items it sells.
    pub covers: Vec<String>,
}

/// A person's way to the event and the stores on it.
#[derive(Debug, Clone, Serialize)]
pub struct TripView {
    /// The driving route, when the person shared a starting point and routing worked.
    pub route: Option<Route>,
    /// Ranked stores.
    pub stores: Vec<StoreStop>,
}

const ROUTE_CORRIDOR_M: u32 = 1500;
const MEETING_POINT_RADIUS_M: u32 = 6000;
const MAX_ROUTED_CANDIDATES: usize = 40;
const MAX_STOPS_SHOWN: usize = 12;
const MAX_STOPS_PER_SHOP_TAG: usize = 3;

/// The forecast and elevation at the meeting point, cached for 30 minutes.
pub async fn conditions(state: &AppState, event: &Event) -> Conditions {
    if let Some(cached) = state.conditions.get(&event.id) {
        return cached;
    }
    let point = LatLng { lat: event.lat, lng: event.lng };
    let (elevation, forecast) = tokio::join!(
        state.places.elevation_m(point),
        state.places.day_forecast(point, event.starts_at)
    );
    let found = Conditions {
        elevation_m: elevation.unwrap_or_else(|error| {
            tracing::warn!(%error, "elevation lookup failed");
            None
        }),
        forecast: forecast.unwrap_or_else(|error| {
            tracing::warn!(%error, "forecast lookup failed");
            None
        }),
    };
    state.conditions.put(event.id.clone(), found.clone());
    found
}

/// Lines describing what earlier groups bought alongside items on this list.
async fn learned_pairings(state: &AppState, listed: &[String]) -> ApiResult<Vec<String>> {
    let baskets = state.db.call(|connection| prep::baskets(connection)).await?;
    let mut lines = Vec::new();
    for name in listed {
        for pairing in bought_with(&baskets, name, EvidenceThreshold::default()).into_iter().take(3) {
            lines.push(format!(
                "groups that got {} also got {} in {} trips ({:.0}% of the time, lift {:.1})",
                name.to_lowercase(),
                pairing.item,
                pairing.together,
                pairing.confidence * 100.0,
                pairing.lift
            ));
        }
    }
    Ok(lines)
}

/// Everything the model is told about this event, from `drive`'s point of view when given.
pub async fn trip_facts(state: &AppState, event: &Event, drive: Option<&Route>) -> ApiResult<TripFacts> {
    let found = conditions(state, event).await;
    let event_id = event.id.clone();
    let items = state.db.call(move |connection| prep::list(connection, &event_id)).await?;
    let mut already_listed = Vec::with_capacity(items.len());
    for item in &items {
        already_listed.push(item.name.clone());
    }
    let learned = learned_pairings(state, &already_listed).await?;
    let offset = event.tz_offset_minutes;
    let weather = found.forecast.map(|forecast| WeatherFacts {
        max_temp_c: forecast.max_temp_c,
        min_temp_c: forecast.min_temp_c,
        precipitation_chance: forecast.precipitation_chance,
        precipitation_mm: forecast.precipitation_mm,
        snowfall_cm: forecast.snowfall_cm,
        max_wind_kmh: forecast.max_wind_kmh,
        max_uv_index: forecast.max_uv_index,
        sunrise_local: format_local_clock(forecast.sunrise, offset),
        sunset_local: format_local_clock(forecast.sunset, offset),
    });
    Ok(TripFacts {
        title: event.title.clone(),
        description: event.description.clone(),
        place_name: event.place_name.clone(),
        starts_local: format_local(event.starts_at, offset),
        group_size: u32::try_from(event.going_count).unwrap_or(1),
        elevation_m: found.elevation_m,
        weather,
        drive: drive.map(|route| DriveFacts {
            minutes: route.duration_minutes,
            km: route.distance_km,
        }),
        already_listed,
        learned_pairings: learned,
    })
}

/// Items the viewer still needs: their own copy of personal items, and shared items nobody has taken on.
pub fn still_needed(items: &[PrepItem], viewer_id: &str) -> Vec<NeededItem> {
    let mut needed = Vec::new();
    for item in items {
        let open = match item.scope.as_str() {
            "shared" => item.marks.is_empty(),
            _ => !item
                .marks
                .iter()
                .any(|mark| mark.user_id == viewer_id && mark.state == "got"),
        };
        if open && !item.shop_tags.is_empty() {
            needed.push(NeededItem {
                name: item.name.clone(),
                shop_tags: item.shop_tags.clone(),
            });
        }
    }
    needed
}

fn cache_key(line: &[LatLng], tags: &[String]) -> String {
    let mut key = String::new();
    for point in line {
        key.push_str(&format!("{:.3},{:.3};", point.lat, point.lng));
    }
    let mut sorted_tags = tags.to_vec();
    sorted_tags.sort();
    key.push('|');
    key.push_str(&sorted_tags.join(","));
    key
}

async fn stores_near(state: &AppState, line: &[LatLng], radius_m: u32, tags: &[String]) -> ApiResult<Vec<Store>> {
    let key = format!("{}@{radius_m}", cache_key(line, tags));
    if let Some(cached) = state.store_lookups.get(&key) {
        return Ok(cached);
    }
    let found = state.places.stores_along(line, radius_m, tags).await?;
    let mut rows = Vec::with_capacity(found.len());
    for store in found {
        rows.push(OsmStore {
            osm_ref: store.osm_ref,
            name: store.name,
            shop_tag: store.shop_tag,
            lat: store.location.lat,
            lng: store.location.lng,
            address: store.address,
            opening_hours: store.opening_hours,
        });
    }
    let saved = state.db.call(move |connection| stores::upsert(connection, &rows)).await?;
    state.store_lookups.put(key, saved.clone());
    Ok(saved)
}

/// The route from `origin` (when given) to the event, and the best stores for `needed` on the way.
///
/// Without an origin, stores around the meeting point are ranked by the
/// round trip from there.
pub async fn plan_stops(
    state: &AppState,
    event: &Event,
    origin: Option<LatLng>,
    needed: &[NeededItem],
) -> ApiResult<TripView> {
    let destination = LatLng { lat: event.lat, lng: event.lng };
    let route = match origin {
        Some(start) => match state.places.route(start, destination).await {
            Ok(route) => Some(route),
            Err(error) => {
                tracing::warn!(%error, "routing failed; using a straight line");
                None
            }
        },
        None => None,
    };
    let line: Vec<LatLng> = match (&route, origin) {
        (Some(found), _) => found.points.clone(),
        (None, Some(start)) => vec![start, destination],
        (None, None) => vec![destination],
    };
    let radius_m = match origin {
        Some(_) => ROUTE_CORRIDOR_M,
        None => MEETING_POINT_RADIUS_M,
    };

    let mut tags = Vec::new();
    for item in needed {
        for tag in &item.shop_tags {
            if !tags.contains(tag) {
                tags.push(tag.clone());
            }
        }
    }
    if tags.is_empty() {
        return Ok(TripView { route, stores: Vec::new() });
    }

    let found = stores_near(state, &line, radius_m, &tags).await?;

    let mut candidates = Vec::with_capacity(found.len());
    for store in &found {
        candidates.push(StoreCandidate {
            store_id: store.id.clone(),
            shop_tag: store.shop_tag.clone(),
            location: LatLng { lat: store.lat, lng: store.lng },
            routed_detour_minutes: None,
        });
    }
    candidates.sort_by(|left, right| {
        estimated_detour_minutes(left.location, &line).total_cmp(&estimated_detour_minutes(right.location, &line))
    });
    candidates.truncate(MAX_ROUTED_CANDIDATES);

    if let (Some(start), Some(found_route)) = (origin, &route) {
        let mut points = Vec::with_capacity(candidates.len());
        for candidate in &candidates {
            points.push(candidate.location);
        }
        match state
            .places
            .detour_minutes(start, destination, found_route.duration_minutes, &points)
            .await
        {
            Ok(detours) => {
                for (candidate, detour) in candidates.iter_mut().zip(detours) {
                    candidate.routed_detour_minutes = detour;
                }
            }
            Err(error) => tracing::warn!(%error, "detour table failed; using estimates"),
        }
    }

    let ranked = rank_stores(&candidates, needed, &line, RankingRules::default());
    let mut stops: Vec<StoreStop> = Vec::new();
    for suggestion in ranked {
        if stops.len() == MAX_STOPS_SHOWN {
            break;
        }
        if let Some(store) = found.iter().find(|store| store.id == suggestion.store_id) {
            let same_kind = stops.iter().filter(|stop| stop.store.shop_tag == store.shop_tag).count();
            if same_kind >= MAX_STOPS_PER_SHOP_TAG {
                continue;
            }
            stops.push(StoreStop {
                store: store.clone(),
                detour_minutes: suggestion.detour_minutes,
                detour_is_estimate: suggestion.detour_is_estimate,
                covers: suggestion.covers,
            });
        }
    }
    Ok(TripView { route, stores: stops })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tribe_db::prep::ItemMark;

    fn item(name: &str, scope: &str, marks: Vec<ItemMark>) -> PrepItem {
        PrepItem {
            id: name.to_string(),
            name: name.to_string(),
            why: String::new(),
            scope: scope.to_string(),
            quantity: 1,
            shop_tags: vec!["supermarket".to_string()],
            source: "model".to_string(),
            added_by: None,
            marks,
        }
    }

    fn mark(user_id: &str, state: &str) -> ItemMark {
        ItemMark {
            user_id: user_id.to_string(),
            name: user_id.to_string(),
            state: state.to_string(),
        }
    }

    #[test]
    fn needed_items_follow_scope_rules() {
        let items = vec![
            item("Water", "personal", vec![mark("bo", "got")]),
            item("Snacks", "personal", vec![mark("ada", "got")]),
            item("First-aid kit", "shared", vec![mark("bo", "bringing")]),
            item("Park pass", "shared", Vec::new()),
        ];
        let needed: Vec<String> = still_needed(&items, "ada").into_iter().map(|item| item.name).collect();
        assert_eq!(needed, vec!["Water".to_string(), "Park pass".to_string()]);
    }
}
