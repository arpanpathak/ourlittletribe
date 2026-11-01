//! Stores on a person's way to an event that sell what they still need,
//! ranked by how much of the list each covers and how far out of the way it is.

use serde::Serialize;
use tribe_core::geo::{Bounds, LatLng, distance_to_route_km, estimated_detour_minutes};
use tribe_core::recommend::{
    Detour, NeededItem, RankingRules, StoreCandidate, StoreSuggestion, rank_stores,
};
use tribe_db::events::Event;
use tribe_db::ids::{StoreId, UserId};
use tribe_db::kinds::{MarkState, Scope};
use tribe_db::prep::PrepItem;
use tribe_db::stores::{self, OsmStore, Store};
use tribe_places::osrm::Route;
use tribe_places::overpass::FoundStore;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// How far from the route a store may be, metres.
const ROUTE_CORRIDOR_M: u32 = 1500;

/// Without a starting point, how far from the meeting point a store may be, metres.
const MEETING_POINT_RADIUS_M: u32 = 6000;

/// Stores whose detour is asked of the routing service at most.
const MOST_ROUTED_CANDIDATES: usize = 40;

/// Stores shown at most.
const MOST_STOPS: usize = 12;

/// Stores of one kind shown at most, so three supermarkets do not crowd out an outdoor shop.
const MOST_STOPS_PER_KIND: usize = 3;

/// Metres in a degree of latitude.
const METRES_PER_DEGREE: f64 = 111_000.0;

/// What the page says when only remembered stores could be shown.
const REMEMBERED_STORES_NOTICE: &str = "OpenStreetMap's store search is busy right now, so only stores found \
     on earlier searches are shown. Try again in a few minutes.";

/// A store worth a stop, and why.
#[derive(Debug, Clone, Serialize)]
pub struct StoreStop {
    /// The store.
    pub store: Store,
    /// How far out of the way it is.
    pub detour: Detour,
    /// The needed items it sells.
    pub covers: Vec<String>,
}

/// A person's way to an event and the stores on it.
#[derive(Debug, Clone, Serialize)]
pub struct TripView {
    /// The driving route, when the person shared a starting point and routing worked.
    pub route: Option<Route>,
    /// The stores worth a stop, best first.
    pub stores: Vec<StoreStop>,
    /// Set when OpenStreetMap could not be searched and only remembered stores are shown.
    pub notice: Option<String>,
}

/// Where to look for stores: a line to follow, and how far from it.
struct SearchArea {
    /// The route, or the start and end, or just the meeting point.
    line: Vec<LatLng>,
    /// How far from the line a store may be, metres.
    radius_m: u32,
}

impl SearchArea {
    fn new(route: Option<&Route>, origin: Option<LatLng>, destination: LatLng) -> SearchArea {
        let line = match (route, origin) {
            (Some(route), _) => route.points.clone(),
            (None, Some(start)) => vec![start, destination],
            (None, None) => vec![destination],
        };
        let radius_m = match origin {
            Some(_) => ROUTE_CORRIDOR_M,
            None => MEETING_POINT_RADIUS_M,
        };
        SearchArea { line, radius_m }
    }

    /// A box around the whole area, to ask the database for remembered stores.
    fn bounds(&self) -> Bounds {
        let margin = f64::from(self.radius_m) / METRES_PER_DEGREE;
        let mut bounds = Bounds {
            west: f64::MAX,
            south: f64::MAX,
            east: f64::MIN,
            north: f64::MIN,
        };

        for point in &self.line {
            bounds.south = bounds.south.min(point.lat);
            bounds.north = bounds.north.max(point.lat);
            bounds.west = bounds.west.min(point.lng);
            bounds.east = bounds.east.max(point.lng);
        }

        let widest_latitude = bounds.south.abs().max(bounds.north.abs());
        let lng_margin = margin / widest_latitude.to_radians().cos().max(0.2);
        Bounds {
            west: bounds.west - lng_margin,
            south: bounds.south - margin,
            east: bounds.east + lng_margin,
            north: bounds.north + margin,
        }
    }

    fn contains(&self, store: &Store) -> bool {
        distance_to_route_km(store.osm.location, &self.line) <= f64::from(self.radius_m) / 1000.0
    }

    /// A cache key for this area and set of shop kinds.
    fn cache_key(&self, tags: &[String]) -> String {
        let points: Vec<String> = self
            .line
            .iter()
            .map(|point| format!("{:.3},{:.3}", point.lat, point.lng))
            .collect();
        let mut sorted_tags = tags.to_vec();
        sorted_tags.sort();
        format!(
            "{}|{}@{}",
            points.join(";"),
            sorted_tags.join(","),
            self.radius_m
        )
    }
}

/// Whether one item still needs buying by the viewer: their own copy of a
/// personal item they have not got, or a shared item nobody has taken on.
fn still_open(item: &PrepItem, viewer_id: &UserId) -> bool {
    match item.scope {
        Scope::Shared => item.marks.is_empty(),
        Scope::Personal => !item
            .marks
            .iter()
            .any(|mark| &mark.user_id == viewer_id && mark.state == MarkState::Got),
    }
}

/// What the viewer still needs, with the shops that sell each thing.
pub fn still_needed(items: &[PrepItem], viewer_id: &UserId) -> Vec<NeededItem> {
    items
        .iter()
        .filter(|item| still_open(item, viewer_id) && !item.shop_tags.is_empty())
        .map(|item| NeededItem {
            name: item.name.clone(),
            shop_tags: item.shop_tags.clone(),
        })
        .collect()
}

/// Every shop kind any needed item is sold at, once each.
fn wanted_tags(needed: &[NeededItem]) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for tag in needed.iter().flat_map(|item| &item.shop_tags) {
        if !tags.contains(tag) {
            tags.push(tag.clone());
        }
    }
    tags
}

fn as_osm_store(found: FoundStore) -> OsmStore {
    OsmStore {
        osm_ref: found.osm_ref,
        name: found.name,
        shop_tag: found.shop_tag,
        location: found.location,
        address: found.address,
        opening_hours: found.opening_hours,
    }
}

/// Stores from OpenStreetMap along the area, saved so they can be remembered.
async fn search_openstreetmap(
    state: &AppState,
    area: &SearchArea,
    tags: &[String],
) -> ApiResult<Vec<Store>> {
    let key = area.cache_key(tags);
    if let Some(cached) = state.caches.store_lookups.get(&key) {
        return Ok(cached);
    }
    if state.caches.store_search_cooldown.is_active() {
        return Err(ApiError::Upstream(
            "store search failed a moment ago".to_string(),
        ));
    }

    let found = match state
        .places
        .stores_along(&area.line, area.radius_m, tags)
        .await
    {
        Ok(found) => found,
        Err(error) => {
            state.caches.store_search_cooldown.start();
            return Err(error.into());
        }
    };

    let rows: Vec<OsmStore> = found.into_iter().map(as_osm_store).collect();
    let saved = state
        .db
        .call(move |connection| stores::upsert(connection, &rows))
        .await?;
    state.caches.store_lookups.put(key, saved.clone());
    Ok(saved)
}

/// Stores found on earlier searches inside the area.
async fn remembered_stores(
    state: &AppState,
    area: &SearchArea,
    tags: Vec<String>,
) -> ApiResult<Vec<Store>> {
    let bounds = area.bounds();
    let boxed = state
        .db
        .call(move |connection| stores::within(connection, bounds, &tags))
        .await?;
    Ok(boxed
        .into_iter()
        .filter(|store| area.contains(store))
        .collect())
}

/// The stores found for an area.
struct FoundStores {
    /// The stores.
    stores: Vec<Store>,
    /// Set when OpenStreetMap could not be asked and these are remembered ones.
    notice: Option<String>,
}

/// The stores in the area, from OpenStreetMap or, when it is busy, from memory.
/// Most shop kinds searched one by one through Nominatim, which allows one request a second.
const MOST_NOMINATIM_KINDS: usize = 4;

/// Shops of each wanted kind in the area, from Nominatim, saved to the shared
/// cache. Used when Overpass does not answer.
async fn search_nominatim(
    state: &AppState,
    area: &SearchArea,
    tags: &[String],
) -> ApiResult<Vec<Store>> {
    let bounds = area.bounds();

    let mut found = Vec::new();
    for kind in tags.iter().take(MOST_NOMINATIM_KINDS) {
        match state.places.shops_by_kind(bounds, kind).await {
            Ok(shops) => found.extend(shops),
            Err(error) => tracing::warn!(%error, kind = %kind, "Nominatim shop search failed"),
        }
    }

    let rows: Vec<OsmStore> = found.into_iter().map(as_osm_store).collect();
    let saved = state
        .db
        .call(move |connection| stores::upsert(connection, &rows))
        .await?;

    Ok(saved
        .into_iter()
        .filter(|store| area.contains(store))
        .collect())
}

/// Shops for `tags` in the area: from Overpass, else from Nominatim, else
/// from shops earlier searches found, with a note saying so.
async fn find_stores(
    state: &AppState,
    area: &SearchArea,
    tags: Vec<String>,
) -> ApiResult<FoundStores> {
    let error = match search_openstreetmap(state, area, &tags).await {
        Ok(stores) => {
            return Ok(FoundStores {
                stores,
                notice: None,
            });
        }
        Err(error) => error,
    };
    tracing::warn!(%error, "Overpass store search failed; asking Nominatim");

    let from_nominatim = search_nominatim(state, area, &tags)
        .await
        .unwrap_or_default();
    if !from_nominatim.is_empty() {
        return Ok(FoundStores {
            stores: from_nominatim,
            notice: None,
        });
    }

    let stores = remembered_stores(state, area, tags).await?;
    Ok(FoundStores {
        stores,
        notice: Some(REMEMBERED_STORES_NOTICE.to_string()),
    })
}

/// The stores closest to the line by straight-line estimate, at most [`MOST_ROUTED_CANDIDATES`].
fn shortlist(stores: &[Store], line: &[LatLng]) -> Vec<StoreCandidate<StoreId>> {
    let mut candidates: Vec<StoreCandidate<StoreId>> = stores
        .iter()
        .map(|store| StoreCandidate {
            store_id: store.id.clone(),
            shop_tag: store.osm.shop_tag.clone(),
            location: store.osm.location,
            routed_detour_minutes: None,
        })
        .collect();

    candidates.sort_by(|left, right| {
        estimated_detour_minutes(left.location, line)
            .total_cmp(&estimated_detour_minutes(right.location, line))
    });
    candidates.truncate(MOST_ROUTED_CANDIDATES);
    candidates
}

/// Asks the routing service how many minutes each candidate adds; keeps estimates when it cannot say.
async fn add_routed_detours(
    state: &AppState,
    candidates: &mut [StoreCandidate<StoreId>],
    origin: LatLng,
    destination: LatLng,
    route: &Route,
) {
    let points: Vec<LatLng> = candidates
        .iter()
        .map(|candidate| candidate.location)
        .collect();
    let detours = state
        .places
        .detour_minutes(origin, destination, route.duration_minutes, &points)
        .await;

    match detours {
        Ok(detours) => {
            for (candidate, detour) in candidates.iter_mut().zip(detours) {
                candidate.routed_detour_minutes = detour;
            }
        }
        Err(error) => tracing::warn!(%error, "detour table failed; using estimates"),
    }
}

/// The best stops, at most [`MOST_STOPS`] and [`MOST_STOPS_PER_KIND`] of each kind.
fn pick_stops(ranked: Vec<StoreSuggestion<StoreId>>, stores: &[Store]) -> Vec<StoreStop> {
    let mut stops: Vec<StoreStop> = Vec::new();

    for suggestion in ranked {
        if stops.len() == MOST_STOPS {
            break;
        }
        let Some(store) = stores.iter().find(|store| store.id == suggestion.store_id) else {
            continue;
        };
        let same_kind = stops
            .iter()
            .filter(|stop| stop.store.osm.shop_tag == store.osm.shop_tag)
            .count();
        if same_kind >= MOST_STOPS_PER_KIND {
            continue;
        }

        stops.push(StoreStop {
            store: store.clone(),
            detour: suggestion.detour,
            covers: suggestion.covers,
        });
    }

    stops
}

/// The route from `origin` (when given) to the event's meeting point, and the
/// best stores for `needed` on the way. Without an origin, stores around the
/// meeting point are ranked instead.
pub async fn plan(
    state: &AppState,
    event: &Event,
    origin: Option<LatLng>,
    needed: &[NeededItem],
) -> ApiResult<TripView> {
    let destination = event.meeting_point.point;

    let route = match origin {
        Some(start) => state
            .places
            .route(start, destination)
            .await
            .inspect_err(|error| tracing::warn!(%error, "routing failed"))
            .ok(),
        None => None,
    };

    let tags = wanted_tags(needed);
    if tags.is_empty() {
        return Ok(TripView {
            route,
            stores: Vec::new(),
            notice: None,
        });
    }

    let area = SearchArea::new(route.as_ref(), origin, destination);
    let found = find_stores(state, &area, tags).await?;

    let mut candidates = shortlist(&found.stores, &area.line);
    if let (Some(start), Some(route)) = (origin, &route) {
        add_routed_detours(state, &mut candidates, start, destination, route).await;
    }

    let ranked = rank_stores(&candidates, needed, &area.line, RankingRules::default());
    Ok(TripView {
        route,
        stores: pick_stops(ranked, &found.stores),
        notice: found.notice,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tribe_db::ids::ItemId;
    use tribe_db::prep::{AddedBy, ItemMark};

    fn item(name: &str, scope: Scope, marks: Vec<ItemMark>) -> PrepItem {
        PrepItem {
            id: ItemId::random(),
            name: name.to_string(),
            why: String::new(),
            scope,
            quantity: 1,
            shop_tags: vec!["supermarket".to_string()],
            added_by: AddedBy::Model,
            marks,
        }
    }

    fn mark(user_id: &UserId, state: MarkState) -> ItemMark {
        ItemMark {
            user_id: user_id.clone(),
            name: user_id.to_string(),
            avatar: None,
            state,
        }
    }

    #[test]
    fn needed_items_follow_the_scope_rules() {
        let ada = UserId::from("ada");
        let bo = UserId::from("bo");
        let items = vec![
            item("Water", Scope::Personal, vec![mark(&bo, MarkState::Got)]),
            item("Snacks", Scope::Personal, vec![mark(&ada, MarkState::Got)]),
            item(
                "First-aid kit",
                Scope::Shared,
                vec![mark(&bo, MarkState::Bringing)],
            ),
            item("Park pass", Scope::Shared, Vec::new()),
        ];

        let needed: Vec<String> = still_needed(&items, &ada)
            .into_iter()
            .map(|item| item.name)
            .collect();

        assert_eq!(needed, vec!["Water".to_string(), "Park pass".to_string()]);
    }

    #[test]
    fn the_search_box_grows_by_the_radius() {
        let area = SearchArea::new(
            None,
            None,
            LatLng {
                lat: 47.6,
                lng: -122.3,
            },
        );
        let bounds = area.bounds();
        assert!(bounds.south < 47.6 - 0.05 && bounds.north > 47.6 + 0.05);
    }
}
