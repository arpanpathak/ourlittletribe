//! Places on the map: plain search, the model's best matches, and naming a point.

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use tribe_core::geo::{LatLng, haversine_km};
use tribe_places::address::PlaceMatch;

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::place_search::{self, other_spelling};
use crate::state::AppState;

/// Plain search results, at most.
const PLAIN_RESULTS: u8 = 7;

/// Query of the place searches.
#[derive(Deserialize)]
pub struct PlaceQuery {
    /// What was typed, 3 to 150 characters.
    q: String,
    /// Where the person is looking, to prefer nearby places.
    lat: Option<f64>,
    /// See `lat`.
    lng: Option<f64>,
}

/// A checked search: the text and the point to prefer.
struct CheckedSearch {
    /// The text.
    text: String,
    /// Where to prefer places near, when given and on the map.
    near: Option<LatLng>,
}

impl PlaceQuery {
    fn checked(self) -> ApiResult<CheckedSearch> {
        let text = bounded(&self.q, 150, "search is too long")?;
        if text.chars().count() < 3 {
            return Err(ApiError::Invalid("type at least three letters"));
        }

        let near = match (self.lat, self.lng) {
            (Some(lat), Some(lng)) => LatLng::new(lat, lng),
            _ => None,
        };
        Ok(CheckedSearch { text, near })
    }
}

/// Two results closer than this, with the same name, are one place, km.
const SAME_PLACE_KM: f64 = 0.3;

/// Whether `place` is already in `kept`: the same name, a few hundred metres away at most.
/// Kinds of place OpenStreetMap draws as lines, which come back from a
/// search as many pieces with the same name.
const LINE_KINDS: &[&str] = &["path", "footway", "track", "bridleway", "cycleway", "steps"];

/// How far apart two pieces of one trail may be, km.
const SAME_TRAIL_KM: f64 = 20.0;

fn already_kept(kept: &[PlaceMatch], place: &PlaceMatch) -> bool {
    let is_line = LINE_KINDS.contains(&place.kind.as_str());

    kept.iter().any(|other| {
        let same_name = other.name.eq_ignore_ascii_case(&place.name);
        let apart = haversine_km(other.location, place.location);
        let same_trail = is_line && other.kind == place.kind && apart < SAME_TRAIL_KM;
        same_name && (apart < SAME_PLACE_KM || same_trail)
    })
}

/// Every place once, nearest to `near` first when it is known.
fn merged(lists: Vec<Vec<PlaceMatch>>, near: Option<LatLng>) -> Vec<PlaceMatch> {
    let mut kept: Vec<PlaceMatch> = Vec::new();
    for place in lists.into_iter().flatten() {
        if !already_kept(&kept, &place) {
            kept.push(place);
        }
    }

    if let Some(point) = near {
        let distance = |place: &PlaceMatch| haversine_km(point, place.location);
        kept.sort_by(|first, second| distance(first).total_cmp(&distance(second)));
    }

    kept.truncate(usize::from(PLAIN_RESULTS));
    kept
}

/// `GET /api/places?q=…&lat=…&lng=…`: OpenStreetMap matches for the text, nearest first.
/// "and" and "&" are both tried, since map names use either.
pub async fn search(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PlaceQuery>,
) -> ApiResult<Json<Vec<PlaceMatch>>> {
    let search = query.checked()?;
    let places = &state.places;

    let Some(other) = other_spelling(&search.text) else {
        let found = places
            .search_places(&search.text, search.near, PLAIN_RESULTS)
            .await?;
        return Ok(Json(merged(vec![found], search.near)));
    };

    let (as_typed, respelled) = tokio::join!(
        places.search_places(&search.text, search.near, PLAIN_RESULTS),
        places.search_places(&other, search.near, PLAIN_RESULTS),
    );

    let lists = [as_typed, respelled]
        .into_iter()
        .filter_map(Result::ok)
        .collect();
    Ok(Json(merged(lists, search.near)))
}

/// `GET /api/places/best-matches?q=…&lat=…&lng=…`: the places the model thinks
/// the text means, each one real. Slower than `/api/places`; the page asks both.
pub async fn best_matches(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PlaceQuery>,
) -> ApiResult<Json<Vec<PlaceMatch>>> {
    let search = query.checked()?;
    Ok(Json(
        place_search::best_matches(&state, &search.text, search.near).await,
    ))
}

/// `GET /api/places/nearest?lat=…&lng=…`: the named place or address at a point.
pub async fn nearest(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(point): Query<LatLng>,
) -> ApiResult<Json<Option<PlaceMatch>>> {
    let point = LatLng::new(point.lat, point.lng)
        .ok_or(ApiError::Invalid("that point is not on the map"))?;
    let found = state.places.place_at(point).await?;
    Ok(Json(found))
}
