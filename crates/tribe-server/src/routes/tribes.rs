//! Tribes: list, start, view, join and leave.

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use tribe_db::events::{self, Event};
use tribe_db::tribes::{self, EMBLEMS, Member, Tribe};
use tribe_db::{activity_log, unix_now};

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// `GET /api/tribes`.
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

/// Body of a new tribe.
#[derive(Deserialize)]
pub struct NewTribe {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    home_area: String,
    #[serde(default)]
    emblem: String,
}

/// `POST /api/tribes`.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(body): Json<NewTribe>,
) -> ApiResult<Json<Tribe>> {
    let name = bounded(&body.name, 80, "name is too long")?;
    if name.is_empty() {
        return Err(ApiError::Invalid("give the tribe a name"));
    }
    let description = bounded(&body.description, 4000, "description is too long")?;
    let home_area = bounded(&body.home_area, 80, "home area is too long")?;
    let emblem = match EMBLEMS.contains(&body.emblem.as_str()) {
        true => body.emblem,
        false => "peak".to_string(),
    };
    let tribe = state
        .db
        .call(move |connection| {
            let tribe = tribes::create(
                connection,
                &user.id,
                &name,
                &description,
                &home_area,
                &emblem,
            )?;
            let summary = format!("{} started {}", user.name, tribe.name);
            activity_log::record(
                connection,
                &user.id,
                "started_tribe",
                "tribe",
                &tribe.id,
                &summary,
            )?;
            Ok(tribe)
        })
        .await?;
    Ok(Json(tribe))
}

/// Body of a tribe change.
#[derive(Deserialize)]
pub struct TribeChange {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    home_area: String,
}

/// `PATCH /api/tribes/{tribe_id}`: for the tribe's organizers and admins.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
    Json(change): Json<TribeChange>,
) -> ApiResult<Json<Tribe>> {
    super::media::require_organizer(&state, &tribe_id, &user).await?;
    let name = bounded(&change.name, 80, "name is too long")?;
    if name.is_empty() {
        return Err(ApiError::Invalid("give the tribe a name"));
    }
    let description = bounded(&change.description, 4000, "description is too long")?;
    let home_area = bounded(&change.home_area, 80, "home area is too long")?;
    let tribe = state
        .db
        .call(move |connection| {
            tribes::update(
                connection,
                &tribe_id,
                &user.id,
                &name,
                &description,
                &home_area,
            )
        })
        .await?;
    Ok(Json(tribe))
}

/// A tribe with its members, upcoming events and recent ones.
#[derive(Serialize)]
pub struct TribeDetail {
    tribe: Tribe,
    members: Vec<Member>,
    events: Vec<Event>,
    past_events: Vec<Event>,
}

/// `GET /api/tribes/{tribe_id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
) -> ApiResult<Json<TribeDetail>> {
    let detail = state
        .db
        .call(move |connection| {
            Ok(TribeDetail {
                tribe: tribes::get(connection, &tribe_id, &user.id)?,
                members: tribes::members(connection, &tribe_id)?,
                events: events::upcoming(
                    connection,
                    &user.id,
                    Some(&tribe_id),
                    unix_now() - 6 * 3600,
                    50,
                )?,
                past_events: events::past(
                    connection,
                    &user.id,
                    &tribe_id,
                    unix_now() - 6 * 3600,
                    12,
                )?,
            })
        })
        .await?;
    Ok(Json(detail))
}

/// `POST /api/tribes/{tribe_id}/join`.
pub async fn join(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
) -> ApiResult<Json<Tribe>> {
    let tribe = state
        .db
        .call(move |connection| {
            let already = tribes::is_member(connection, &tribe_id, &user.id)?;
            tribes::join(connection, &tribe_id, &user.id)?;
            let tribe = tribes::get(connection, &tribe_id, &user.id)?;
            if !already {
                let summary = format!("{} joined {}", user.name, tribe.name);
                activity_log::record(
                    connection,
                    &user.id,
                    "joined_tribe",
                    "tribe",
                    &tribe.id,
                    &summary,
                )?;
            }
            Ok(tribe)
        })
        .await?;
    Ok(Json(tribe))
}

/// `POST /api/tribes/{tribe_id}/leave`.
pub async fn leave(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
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
