//! The home feed, and searching events, tribes and people by their words.

use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use tribe_db::activity_log::{self, ActivityEntry};
use tribe_db::events::{self, Event};
use tribe_db::search::{self, SearchResults};
use tribe_db::tribes::{self, Tribe};
use tribe_db::unix_now;

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Events stay in "upcoming" until six hours after they start.
const STILL_UPCOMING_SECONDS: i64 = 6 * 3600;

/// What the home page shows.
#[derive(Serialize)]
pub struct Feed {
    /// The next 30 events in any tribe, soonest first.
    upcoming: Vec<Event>,
    /// The tribes you belong to.
    my_tribes: Vec<Tribe>,
    /// The latest 30 things people did in your tribes.
    activity: Vec<ActivityEntry>,
}

/// `GET /api/feed`: your home page.
pub async fn feed(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<Feed>> {
    let cutoff = unix_now() - STILL_UPCOMING_SECONDS;

    let feed = state
        .db
        .call(move |connection| {
            Ok(Feed {
                upcoming: events::upcoming(connection, &user.id, None, cutoff, 30)?,
                my_tribes: tribes::for_user(connection, &user.id)?,
                activity: activity_log::recent_for(connection, &user.id, 30)?,
            })
        })
        .await?;
    Ok(Json(feed))
}

/// Query of `GET /api/search`.
#[derive(Deserialize)]
pub struct SearchQuery {
    /// The words to look for, 2 to 100 characters.
    q: String,
}

/// `GET /api/search?q=…`: events, tribes and people whose words contain the text.
pub async fn search(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(query): Query<SearchQuery>,
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
