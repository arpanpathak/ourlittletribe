//! The HTTP API, one module per resource, and the web app.
//!
//! | Resource | Routes |
//! |---|---|
//! | sessions | `POST /api/sessions`, `DELETE /api/sessions/current` |
//! | users | `POST /api/users`, `GET`/`PATCH /api/users/me`, `GET /api/users/{id}`, `PUT`/`DELETE /api/users/me/avatar` and `/cover` |
//! | tribes | `GET`/`POST /api/tribes`, `GET`/`PATCH /api/tribes/{id}`, `PUT`/`DELETE /api/tribes/{id}/members/me` and `/cover` |
//! | events | `GET`/`POST /api/events`, `GET`/`PATCH`/`DELETE /api/events/{id}`, `PUT /rsvp`, `PUT`/`DELETE /vote`, `/origin`, `/cover` |
//! | photos | `POST /api/events/{id}/photos`, `DELETE /api/photos/{id}`, `POST /api/pictures` |
//! | items | `POST /api/events/{id}/items`, `POST /api/events/{id}/item-plans`, `GET /api/events/{id}/item-suggestions`, `PUT`/`DELETE /api/items/{id}/marks/me`, `DELETE /api/items/{id}` |
//! | trip | `GET /api/events/{id}/trip`, `GET /api/events/{id}/briefing` |
//! | places | `GET /api/places`, `GET /api/places/best-matches`, `GET /api/places/nearest` |
//! | drafts | `POST /api/event-drafts`, `/api/tribe-drafts`, `/api/description-drafts`, `/api/cover-scenes`, `/api/cover-drawings` |
//! | feed | `GET /api/feed`, `GET /api/search`, `GET /api/search/related` |

mod access;
mod drafts;
mod drawings;
mod events;
mod feed;
mod items;
mod pictures;
mod places;
mod tribes;
mod trip;
mod users;

use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use tribe_brain::Brain;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::{auth, web};

/// Text trimmed, if it fits in `max_chars`; otherwise the request is refused with `problem`.
pub(crate) fn bounded(text: &str, max_chars: usize, problem: &'static str) -> ApiResult<String> {
    let trimmed = text.trim();
    match trimmed.chars().count() <= max_chars {
        true => Ok(trimmed.to_string()),
        false => Err(ApiError::Invalid(problem)),
    }
}

/// The model, or `503` when this server has none.
pub(crate) fn model(state: &AppState) -> ApiResult<Arc<Brain>> {
    state.brain.clone().ok_or(ApiError::NoModel)
}

/// Picture uploads may be 15 MB, plus room for the request around them.
fn picture_upload() -> DefaultBodyLimit {
    DefaultBodyLimit::max(tribe_media::MAX_UPLOAD_BYTES + 64 * 1024)
}

fn account_routes() -> Router<AppState> {
    Router::new()
        .route("/sessions", post(auth::sign_in))
        .route("/sessions/current", delete(auth::sign_out))
        .route("/users", post(auth::create_account))
        .route("/users/me", get(users::me).patch(users::update_me))
        .route(
            "/users/me/avatar",
            put(pictures::set_avatar)
                .delete(pictures::remove_avatar)
                .layer(picture_upload()),
        )
        .route(
            "/users/me/cover",
            put(pictures::set_profile_cover)
                .delete(pictures::remove_profile_cover)
                .layer(picture_upload()),
        )
        .route("/users/{user_id}", get(users::profile))
}

fn tribe_routes() -> Router<AppState> {
    Router::new()
        .route("/tribes", get(tribes::list).post(tribes::create))
        .route(
            "/tribes/{tribe_id}",
            get(tribes::detail).patch(tribes::update),
        )
        .route(
            "/tribes/{tribe_id}/members/me",
            put(tribes::join).delete(tribes::leave),
        )
        .route(
            "/tribes/{tribe_id}/cover",
            put(pictures::set_tribe_cover)
                .delete(pictures::remove_tribe_cover)
                .layer(picture_upload()),
        )
}

fn event_routes() -> Router<AppState> {
    Router::new()
        .route("/events", get(events::list).post(events::create))
        .route(
            "/events/{event_id}",
            get(events::detail)
                .patch(events::update)
                .delete(events::remove),
        )
        .route("/events/{event_id}/rsvp", put(events::set_rsvp))
        .route(
            "/events/{event_id}/vote",
            put(events::set_vote).delete(events::remove_vote),
        )
        .route(
            "/events/{event_id}/origin",
            put(events::set_origin).delete(events::clear_origin),
        )
        .route(
            "/events/{event_id}/cover",
            put(pictures::set_event_cover)
                .delete(pictures::remove_event_cover)
                .layer(picture_upload()),
        )
        .route(
            "/events/{event_id}/photos",
            post(pictures::add_photo).layer(picture_upload()),
        )
        .route("/events/{event_id}/trip", get(trip::trip))
        .route("/events/{event_id}/briefing", get(trip::briefing))
        .route("/events/{event_id}/trails", get(trip::trails))
        .route("/photos/{image_id}", delete(pictures::remove_photo))
        .route(
            "/pictures",
            post(pictures::add_inline).layer(picture_upload()),
        )
}

fn item_routes() -> Router<AppState> {
    Router::new()
        .route("/events/{event_id}/items", post(items::add))
        .route("/events/{event_id}/item-plans", post(items::plan))
        .route(
            "/events/{event_id}/item-suggestions",
            get(items::suggestions),
        )
        .route("/items/{item_id}", delete(items::remove))
        .route(
            "/items/{item_id}/marks/me",
            put(items::set_mark).delete(items::clear_mark),
        )
}

fn discovery_routes() -> Router<AppState> {
    Router::new()
        .route("/feed", get(feed::feed))
        .route("/search", get(feed::search))
        .route("/search/related", get(feed::related))
        .route("/places", get(places::search))
        .route("/places/best-matches", get(places::best_matches))
        .route("/places/nearest", get(places::nearest))
        .route("/event-drafts", post(drafts::event_draft))
        .route("/description-drafts", post(drafts::description_draft))
        .route("/tribe-drafts", post(drafts::tribe_draft))
        .route("/cover-scenes", post(drafts::cover_scene))
        .route("/cover-drawings", post(drawings::cover_drawing))
}

/// Every route: the API under `/api`, pictures under `/media`, the health check, and the web app.
pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(account_routes())
        .merge(tribe_routes())
        .merge(event_routes())
        .merge(item_routes())
        .merge(discovery_routes());

    Router::new()
        .nest("/api", api)
        .route("/media/{file_name}", get(pictures::serve))
        .route(
            "/health",
            get(|| async { axum::Json(serde_json::json!({ "status": "ok" })) }),
        )
        .fallback(web::serve)
        .with_state(state)
}
