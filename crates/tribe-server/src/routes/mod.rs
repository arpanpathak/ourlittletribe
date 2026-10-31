//! The HTTP routes.

mod account;
mod discover;
mod events;
mod prep;
mod tribes;

use axum::Router;
use axum::routing::{delete, get, post, put};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::{auth, web};

/// Checks that text fits within `max_chars` after trimming, and returns it trimmed.
pub(crate) fn bounded(text: &str, max_chars: usize, problem: &'static str) -> ApiResult<String> {
    let trimmed = text.trim();
    match trimmed.chars().count() <= max_chars {
        true => Ok(trimmed.to_string()),
        false => Err(ApiError::Invalid(problem)),
    }
}

/// Fails unless `user_id` belongs to the tribe.
pub(crate) async fn require_member(state: &AppState, tribe_id: &str, user_id: &str) -> ApiResult<()> {
    let tribe_id = tribe_id.to_string();
    let user_id = user_id.to_string();
    let member = state
        .db
        .call(move |connection| tribe_db::tribes::is_member(connection, &tribe_id, &user_id))
        .await?;
    match member {
        true => Ok(()),
        false => Err(ApiError::Forbidden("join the tribe first")),
    }
}

/// Every route: the API under `/api`, the health check, and the web app.
pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/account/register", post(auth::register))
        .route("/account/login", post(auth::login))
        .route("/account/logout", post(auth::logout))
        .route("/me", get(account::me).patch(account::update_me))
        .route("/people/{user_id}", get(account::profile))
        .route("/tribes", get(tribes::list).post(tribes::create))
        .route("/tribes/{tribe_id}", get(tribes::detail))
        .route("/tribes/{tribe_id}/join", post(tribes::join))
        .route("/tribes/{tribe_id}/leave", post(tribes::leave))
        .route("/events", get(events::list).post(events::create))
        .route("/events/{event_id}", get(events::detail).delete(events::remove))
        .route("/events/{event_id}/rsvp", post(events::rsvp))
        .route("/events/{event_id}/vote", post(events::vote))
        .route("/events/{event_id}/origin", put(events::set_origin).delete(events::clear_origin))
        .route("/events/{event_id}/plan", post(prep::plan))
        .route("/events/{event_id}/items", post(prep::add))
        .route("/events/{event_id}/find", post(prep::find))
        .route("/events/{event_id}/trip", get(prep::trip))
        .route("/items/{item_id}/mark", post(prep::mark))
        .route("/items/{item_id}", delete(prep::remove))
        .route("/feed", get(discover::feed))
        .route("/search", get(discover::search))
        .route("/places", get(discover::places));

    Router::new()
        .nest("/api", api)
        .route("/health", get(|| async { axum::Json(serde_json::json!({ "status": "ok" })) }))
        .fallback(web::serve)
        .with_state(state)
}
