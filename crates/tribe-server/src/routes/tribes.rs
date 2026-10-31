//! Tribes: list, start, view, change, join and leave.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tribe_db::activity_log::{self, About};
use tribe_db::events::{self, Event};
use tribe_db::ids::TribeId;
use tribe_db::kinds::Action;
use tribe_db::tribes::{self, Member, Tribe, TribeText};
use tribe_db::unix_now;

use super::access::require_organizer;
use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Events stay in "upcoming" until six hours after they start.
const STILL_UPCOMING_SECONDS: i64 = 6 * 3600;

/// `GET /api/tribes`: every tribe, yours first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<Vec<Tribe>>> {
    let found = state
        .db
        .call(move |connection| tribes::list(connection, &user.id))
        .await?;
    Ok(Json(found))
}

/// Body of `POST /api/tribes` and `PATCH /api/tribes/{id}`.
#[derive(Deserialize)]
pub struct TribeFields {
    /// Name, 1 to 80 characters.
    name: String,
    /// What it is about, in Markdown, at most 4,000 characters.
    #[serde(default)]
    description: String,
    /// Where it usually meets, at most 80 characters.
    #[serde(default)]
    home_area: String,
}

impl TribeFields {
    fn checked(self) -> ApiResult<TribeText> {
        let name = bounded(&self.name, 80, "name is too long")?;
        if name.is_empty() {
            return Err(ApiError::Invalid("give the tribe a name"));
        }

        Ok(TribeText {
            name,
            description: bounded(&self.description, 4000, "description is too long")?,
            home_area: bounded(&self.home_area, 80, "home area is too long")?,
        })
    }
}

/// `POST /api/tribes`: starts a tribe, with you as its organizer.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(fields): Json<TribeFields>,
) -> ApiResult<(StatusCode, Json<Tribe>)> {
    let text = fields.checked()?;

    let tribe = state
        .db
        .call(move |connection| {
            let tribe = tribes::create(connection, &user.id, &text)?;
            let summary = format!("{} started {}", user.name, tribe.name);
            activity_log::record(
                connection,
                &user.id,
                Action::StartedTribe,
                &About::Tribe(tribe.id.clone()),
                &summary,
            )?;
            Ok(tribe)
        })
        .await?;

    Ok((StatusCode::CREATED, Json(tribe)))
}

/// `PATCH /api/tribes/{tribe_id}`: for the tribe's organizers.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
    Json(fields): Json<TribeFields>,
) -> ApiResult<Json<Tribe>> {
    require_organizer(&state, &tribe_id, &user).await?;
    let text = fields.checked()?;

    let tribe = state
        .db
        .call(move |connection| tribes::update(connection, &tribe_id, &user.id, &text))
        .await?;
    Ok(Json(tribe))
}

/// A tribe with its members and events.
#[derive(Serialize)]
pub struct TribeDetail {
    /// The tribe.
    tribe: Tribe,
    /// Its members, organizers first.
    members: Vec<Member>,
    /// Events still to come, soonest first.
    events: Vec<Event>,
    /// The latest twelve events that are over.
    past_events: Vec<Event>,
}

/// `GET /api/tribes/{tribe_id}`: the tribe, its members and its events.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
) -> ApiResult<Json<TribeDetail>> {
    let cutoff = unix_now() - STILL_UPCOMING_SECONDS;

    let detail = state
        .db
        .call(move |connection| {
            Ok(TribeDetail {
                tribe: tribes::get(connection, &tribe_id, &user.id)?,
                members: tribes::members(connection, &tribe_id)?,
                events: events::upcoming(connection, &user.id, Some(&tribe_id), cutoff, 50)?,
                past_events: events::past(connection, &user.id, &tribe_id, cutoff, 12)?,
            })
        })
        .await?;
    Ok(Json(detail))
}

/// `PUT /api/tribes/{tribe_id}/members/me`: joins the tribe. Joining twice changes nothing.
pub async fn join(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
) -> ApiResult<Json<Tribe>> {
    let tribe = state
        .db
        .call(move |connection| {
            let already_in = tribes::role_of(connection, &tribe_id, &user.id)?.is_some();
            tribes::join(connection, &tribe_id, &user.id)?;
            let tribe = tribes::get(connection, &tribe_id, &user.id)?;

            if !already_in {
                let summary = format!("{} joined {}", user.name, tribe.name);
                activity_log::record(
                    connection,
                    &user.id,
                    Action::JoinedTribe,
                    &About::Tribe(tribe.id.clone()),
                    &summary,
                )?;
            }
            Ok(tribe)
        })
        .await?;
    Ok(Json(tribe))
}

/// `DELETE /api/tribes/{tribe_id}/members/me`: leaves the tribe.
pub async fn leave(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
) -> ApiResult<Json<Tribe>> {
    let tribe = state
        .db
        .call(move |connection| {
            tribes::leave(connection, &tribe_id, &user.id)?;
            tribes::get(connection, &tribe_id, &user.id)
        })
        .await?;
    Ok(Json(tribe))
}
