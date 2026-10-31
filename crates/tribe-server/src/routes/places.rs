//! Places on the map: plain search, the model's best matches, and naming a point.

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;
use tribe_core::geo::LatLng;
use tribe_places::address::PlaceMatch;

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::place_search;
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

/// `GET /api/places?q=…&lat=…&lng=…`: OpenStreetMap matches for the text, nearby first.
pub async fn search(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PlaceQuery>,
) -> ApiResult<Json<Vec<PlaceMatch>>> {
    let search = query.checked()?;
    let found = state
        .places
        .search_places(&search.text, search.near, PLAIN_RESULTS)
        .await?;
    Ok(Json(found))
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
