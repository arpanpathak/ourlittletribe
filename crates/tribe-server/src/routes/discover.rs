//! The home feed, text search and place search.

use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;
use tribe_db::activity_log::{self, ActivityEntry};
use tribe_db::events::{self, Event};
use tribe_db::search::{self, SearchResults};
use tribe_db::tribes::{self, Tribe};
use tribe_db::unix_now;
use tribe_places::photon::PlaceMatch;

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// The home page's data.
#[derive(Serialize)]
pub struct Feed {
    upcoming: Vec<Event>,
    my_tribes: Vec<Tribe>,
    activity: Vec<ActivityEntry>,
}

/// `GET /api/feed`.
pub async fn feed(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<Feed>> {
    let feed = state
        .db
        .call(move |connection| {
            Ok(Feed {
                upcoming: events::upcoming(connection, &user.id, None, unix_now() - 6 * 3600, 30)?,
                my_tribes: tribes::for_user(connection, &user.id)?,
                activity: activity_log::recent_for(connection, &user.id, 30)?,
            })
        })
        .await?;
    Ok(Json(feed))
}

/// A text query.
#[derive(Deserialize)]
pub struct TextQuery {
    q: String,
}

/// `GET /api/search?q=…`.
pub async fn search(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<TextQuery>,
) -> ApiResult<Json<SearchResults>> {
    let text = bounded(&query.q, 100, "search is too long")?;
    if text.chars().count() < 2 {
        return Err(ApiError::Invalid("type at least two letters"));
    }
    let results = state
        .db
        .call(move |connection| search::search(connection, &user.id, &text, unix_now()))
        .await?;
    Ok(Json(results))
}

/// A place query, optionally biased towards a point.
#[derive(Deserialize)]
pub struct PlaceQuery {
    q: String,
    lat: Option<f64>,
    lng: Option<f64>,
}

/// `GET /api/places?q=…&lat=…&lng=…`: OpenStreetMap place search, nearest to the point first.
pub async fn places(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PlaceQuery>,
) -> ApiResult<Json<Vec<PlaceMatch>>> {
    let text = bounded(&query.q, 150, "search is too long")?;
    if text.chars().count() < 3 {
        return Err(ApiError::Invalid("type at least three letters"));
    }
    let near = match (query.lat, query.lng) {
        (Some(lat), Some(lng)) => LatLng::new(lat, lng),
        _ => None,
    };
    let found = state.places.search_places(&text, near, 7).await?;
    Ok(Json(found))
}

/// `GET /api/places/smart?q=…&lat=…&lng=…`: places the model thinks the search means,
/// each checked against OpenStreetMap. Slower than `/api/places`; the page asks both.
pub async fn smart_places(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PlaceQuery>,
) -> ApiResult<Json<Vec<PlaceMatch>>> {
    let text = bounded(&query.q, 150, "search is too long")?;
    if text.chars().count() < 3 {
        return Err(ApiError::Invalid("type at least three letters"));
    }
    let near = match (query.lat, query.lng) {
        (Some(lat), Some(lng)) => LatLng::new(lat, lng),
        _ => None,
    };
    Ok(Json(
        crate::place_search::smart_places(&state, &text, near).await,
    ))
}

/// A point on the map.
#[derive(Deserialize)]
pub struct PointQuery {
    lat: f64,
    lng: f64,
}

/// `GET /api/places/at?lat=…&lng=…`: the nearest named place or address, to name a point picked on the map.
pub async fn place_at(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Query(query): Query<PointQuery>,
) -> ApiResult<Json<Option<PlaceMatch>>> {
    let point = LatLng::new(query.lat, query.lng)
        .ok_or(ApiError::Invalid("that point is not on the map"))?;
    let found = state.places.place_at(point).await?;
    Ok(Json(found))
}
