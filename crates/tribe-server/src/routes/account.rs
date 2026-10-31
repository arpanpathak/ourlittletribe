//! The signed-in person's own account, and other people's profiles.

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use tribe_db::events::{self, Event};
use tribe_db::tribes::{self, Tribe};
use tribe_db::users::{self, User};

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// `GET /api/me`.
pub async fn me(CurrentUser(user): CurrentUser) -> Json<User> {
    Json(user)
}

/// Body of a profile change.
#[derive(Deserialize)]
pub struct ProfileChange {
    name: String,
    #[serde(default)]
    bio: String,
    #[serde(default)]
    home_area: String,
}

/// `PATCH /api/me`.
pub async fn update_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(change): Json<ProfileChange>,
) -> ApiResult<Json<User>> {
    let name = bounded(&change.name, 60, "name is too long")?;
    if name.is_empty() {
        return Err(ApiError::Invalid("name cannot be empty"));
    }
    let bio = bounded(&change.bio, 500, "bio is too long")?;
    let home_area = bounded(&change.home_area, 80, "home area is too long")?;
    let updated = state
        .db
        .call(move |connection| {
            users::update_profile(connection, &user.id, &name, &bio, &home_area)
        })
        .await?;
    Ok(Json(updated))
}

/// A person's public profile.
#[derive(Serialize)]
pub struct Profile {
    person: User,
    tribes: Vec<Tribe>,
    events: Vec<Event>,
}

/// `GET /api/people/{user_id}`.
pub async fn profile(
    State(state): State<AppState>,
    CurrentUser(viewer): CurrentUser,
    Path(user_id): Path<String>,
) -> ApiResult<Json<Profile>> {
    let profile = state
        .db
        .call(move |connection| {
            let person = users::get(connection, &user_id)?;
            let person = match person.id == viewer.id {
                true => person,
                false => person.public(),
            };
            Ok(Profile {
                tribes: tribes::for_user(connection, &user_id)?,
                events: events::attending(connection, &user_id, 30)?,
                person,
            })
        })
        .await?;
    Ok(Json(profile))
}
