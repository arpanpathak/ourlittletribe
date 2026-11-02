//! People: your own account, and other people's profiles.

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use tribe_db::events::{self, Event};
use tribe_db::ids::UserId;
use tribe_db::tribes::{self, Tribe};
use tribe_db::users::{self, Profile, User};

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Events shown on a profile, at most.
const PROFILE_EVENTS: u32 = 30;

/// `GET /api/users/me`: the signed-in person, with their email.
pub async fn me(CurrentUser(user): CurrentUser) -> Json<User> {
    Json(user)
}

/// Body of `PATCH /api/users/me`.
#[derive(Deserialize)]
pub struct ProfileChange {
    /// Display name, 1 to 60 characters.
    name: String,
    /// A short self-description, at most 500 characters.
    #[serde(default)]
    bio: String,
    /// A neighbourhood or town, at most 80 characters.
    #[serde(default)]
    home_area: String,
}

impl ProfileChange {
    fn checked(self) -> ApiResult<Profile> {
        let name = bounded(&self.name, 60, "name is too long")?;
        if name.is_empty() {
            return Err(ApiError::Invalid("name cannot be empty"));
        }

        Ok(Profile {
            name,
            bio: bounded(&self.bio, 500, "bio is too long")?,
            home_area: bounded(&self.home_area, 80, "home area is too long")?,
        })
    }
}

/// `PATCH /api/users/me`: changes your name, bio and home area.
pub async fn update_me(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(change): Json<ProfileChange>,
) -> ApiResult<Json<User>> {
    let profile = change.checked()?;
    let updated = state
        .db
        .call(move |connection| users::update_profile(connection, &user.id, &profile))
        .await?;
    Ok(Json(updated))
}

/// A person's public profile.
#[derive(Serialize)]
pub struct ProfilePage {
    /// The person; their email only when it is you.
    person: User,
    /// The tribes they belong to.
    tribes: Vec<Tribe>,
    /// Events they said they are going to, latest first.
    events: Vec<Event>,
}

/// `GET /api/users/{user_id}`: a person's profile, tribes and events.
pub async fn profile(
    State(state): State<AppState>,
    CurrentUser(viewer): CurrentUser,
    Path(user_id): Path<UserId>,
) -> ApiResult<Json<ProfilePage>> {
    let page = state
        .db
        .call(move |connection| {
            let person = users::get(connection, &user_id)?;
            let person = match person.id == viewer.id {
                true => person,
                false => person.public(),
            };

            Ok(ProfilePage {
                tribes: tribes::for_user(connection, &user_id)?,
                events: events::attending(connection, &user_id, PROFILE_EVENTS)?,
                person,
            })
        })
        .await?;
    Ok(Json(page))
}
