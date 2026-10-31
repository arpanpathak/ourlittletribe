//! Pictures: event and tribe covers, event photos, and serving the files.
//!
//! Uploads arrive as the raw picture in the request body. They are decoded,
//! resized and re-encoded off the async threads, a couple at a time.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use axum::http::HeaderValue;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tribe_db::events::Event;
use tribe_db::images::{self, NewImage, Owner, Photo, Purpose};
use tribe_db::tribes::{self, Tribe};
use tribe_db::{activity_log, new_id, unix_now};
use tribe_media::{MediaError, Processed};

use super::{bounded, managed_event, require_member};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

impl From<MediaError> for ApiError {
    fn from(error: MediaError) -> ApiError {
        match error {
            MediaError::NotAPicture => ApiError::Invalid("upload a JPEG, PNG, WebP or GIF picture"),
            MediaError::TooLarge => ApiError::Invalid("that picture is too large (15 MB or 12,000 px at most)"),
            MediaError::Image(error) => {
                tracing::info!(%error, "picture could not be decoded");
                ApiError::Invalid("that picture could not be read")
            }
            MediaError::Io(error) => {
                tracing::error!(%error, "picture storage failed");
                ApiError::Internal
            }
        }
    }
}

/// Decodes, resizes and stores an upload; returns its new id and the processed copy's size.
async fn store_picture(state: &AppState, upload: Bytes) -> ApiResult<(String, Processed)> {
    if upload.is_empty() {
        return Err(ApiError::Invalid("choose a picture to upload"));
    }
    if !state.uploads.allow() {
        return Err(ApiError::TooMany);
    }
    let _permit = state.picture_jobs.acquire().await.map_err(|_| ApiError::Internal)?;
    let media = state.media.clone();
    let id = new_id();
    let saved_id = id.clone();
    let processed = tokio::task::spawn_blocking(move || -> Result<Processed, MediaError> {
        let processed = tribe_media::process(&upload)?;
        media.save(&saved_id, &processed)?;
        Ok(processed)
    })
    .await
    .map_err(|_| ApiError::Internal)??;
    Ok((id, processed))
}

/// Deletes picture files whose rows are gone; failures are only logged.
fn forget_files(state: &AppState, ids: &[String]) {
    for id in ids {
        if let Err(error) = state.media.remove(id) {
            tracing::warn!(%error, %id, "could not delete a picture file");
        }
    }
}

/// What to record about a picture just stored.
struct Stored {
    id: String,
    uploader_id: String,
    purpose: Purpose,
    owner: Owner,
    caption: String,
    width: u32,
    height: u32,
}

/// Records a stored picture; if the row cannot be written, the files are deleted again.
/// Returns the ids of covers it replaced.
async fn record_picture(state: &AppState, stored: Stored) -> ApiResult<Vec<String>> {
    let id = stored.id.clone();
    let written = state
        .db
        .call(move |connection| {
            images::add(
                connection,
                &NewImage {
                    id: &stored.id,
                    uploader_id: &stored.uploader_id,
                    purpose: stored.purpose,
                    owner: stored.owner,
                    caption: &stored.caption,
                    width: stored.width,
                    height: stored.height,
                },
            )
        })
        .await;
    match written {
        Ok(replaced) => Ok(replaced),
        Err(error) => {
            forget_files(state, &[id]);
            Err(error.into())
        }
    }
}

/// `POST /api/events/{event_id}/cover`: for the planner, the tribe's organizers and admins.
pub async fn set_event_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    upload: Bytes,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    let (id, processed) = store_picture(&state, upload).await?;
    let replaced = record_picture(
        &state,
        Stored {
            id,
            uploader_id: user.id.clone(),
            purpose: Purpose::EventCover,
            owner: Owner::Event(event_id.clone()),
            caption: String::new(),
            width: processed.width,
            height: processed.height,
        },
    )
    .await?;
    forget_files(&state, &replaced);
    let event = state
        .db
        .call(move |connection| tribe_db::events::get(connection, &event_id, &user.id))
        .await?;
    Ok(Json(event))
}

/// `DELETE /api/events/{event_id}/cover`.
pub async fn remove_event_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    let (removed, event) = state
        .db
        .call(move |connection| {
            let removed = images::remove_cover(connection, &Owner::Event(event_id.clone()))?;
            Ok((removed, tribe_db::events::get(connection, &event_id, &user.id)?))
        })
        .await?;
    forget_files(&state, &removed);
    Ok(Json(event))
}

/// Fails unless the user organizes the tribe or is an admin.
pub(crate) async fn require_organizer(state: &AppState, tribe_id: &str, user: &tribe_db::users::User) -> ApiResult<()> {
    if user.is_admin {
        return Ok(());
    }
    let tribe_id = tribe_id.to_string();
    let user_id = user.id.clone();
    let organizer = state
        .db
        .call(move |connection| {
            tribes::get(connection, &tribe_id, &user_id)?;
            tribes::is_organizer(connection, &tribe_id, &user_id)
        })
        .await?;
    match organizer {
        true => Ok(()),
        false => Err(ApiError::Forbidden("only the tribe's organizers can change this")),
    }
}

/// `POST /api/tribes/{tribe_id}/cover`: for the tribe's organizers and admins.
pub async fn set_tribe_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
    upload: Bytes,
) -> ApiResult<Json<Tribe>> {
    require_organizer(&state, &tribe_id, &user).await?;
    let (id, processed) = store_picture(&state, upload).await?;
    let replaced = record_picture(
        &state,
        Stored {
            id,
            uploader_id: user.id.clone(),
            purpose: Purpose::TribeCover,
            owner: Owner::Tribe(tribe_id.clone()),
            caption: String::new(),
            width: processed.width,
            height: processed.height,
        },
    )
    .await?;
    forget_files(&state, &replaced);
    let tribe = state.db.call(move |connection| tribes::get(connection, &tribe_id, &user.id)).await?;
    Ok(Json(tribe))
}

/// `DELETE /api/tribes/{tribe_id}/cover`.
pub async fn remove_tribe_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<String>,
) -> ApiResult<Json<Tribe>> {
    require_organizer(&state, &tribe_id, &user).await?;
    let (removed, tribe) = state
        .db
        .call(move |connection| {
            let removed = images::remove_cover(connection, &Owner::Tribe(tribe_id.clone()))?;
            Ok((removed, tribes::get(connection, &tribe_id, &user.id)?))
        })
        .await?;
    forget_files(&state, &removed);
    Ok(Json(tribe))
}

/// Query of a photo upload.
#[derive(Deserialize)]
pub struct PhotoQuery {
    #[serde(default)]
    caption: String,
}

/// `POST /api/events/{event_id}/photos?caption=…`: any member of the event's tribe.
pub async fn add_photo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Query(query): Query<PhotoQuery>,
    upload: Bytes,
) -> ApiResult<Json<Vec<Photo>>> {
    let caption = bounded(&query.caption, 200, "caption is too long")?;
    let lookup_id = event_id.clone();
    let viewer_id = user.id.clone();
    let event = state
        .db
        .call(move |connection| tribe_db::events::get(connection, &lookup_id, &viewer_id))
        .await?;
    require_member(&state, &event.tribe_id, &user.id).await?;
    let (id, processed) = store_picture(&state, upload).await?;
    record_picture(
        &state,
        Stored {
            id,
            uploader_id: user.id.clone(),
            purpose: Purpose::EventPhoto,
            owner: Owner::Event(event_id.clone()),
            caption,
            width: processed.width,
            height: processed.height,
        },
    )
    .await?;
    let photos = state
        .db
        .call(move |connection| {
            let recent_photo_note = activity_log::recent_for(connection, &user.id, 5)?.into_iter().any(|entry| {
                entry.user_id == user.id
                    && entry.action == "shared_photo"
                    && entry.target_id == event_id
                    && entry.created_at > unix_now() - 3600
            });
            if !recent_photo_note {
                let summary = format!("{} shared photos from {}", user.name, event.title);
                activity_log::record(connection, &user.id, "shared_photo", "event", &event_id, &summary)?;
            }
            images::photos(connection, &event_id)
        })
        .await?;
    Ok(Json(photos))
}

/// `DELETE /api/photos/{image_id}`: whoever shared it, the event's managers, or an admin.
pub async fn remove_photo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(image_id): Path<String>,
) -> ApiResult<Json<Vec<Photo>>> {
    let lookup_id = image_id.clone();
    let record = state.db.call(move |connection| images::get(connection, &lookup_id)).await?;
    let event_id = match (&record.purpose, &record.owner) {
        (Purpose::EventPhoto, Owner::Event(event_id)) => event_id.clone(),
        _ => return Err(ApiError::NotFound),
    };
    let shared_it = record.uploader_id.as_deref() == Some(user.id.as_str());
    if !shared_it {
        managed_event(&state, &event_id, &user).await?;
    }
    let photos = state
        .db
        .call(move |connection| {
            images::delete(connection, &image_id)?;
            images::photos(connection, &event_id)
        })
        .await?;
    forget_files(&state, &[record.id]);
    Ok(Json(photos))
}

/// `GET /media/{file}`: a stored picture, `{id}.jpg` or `{id}_s.jpg`, for signed-in people.
pub async fn serve(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Path(file_name): Path<String>,
) -> ApiResult<Response> {
    let (id, size) = tribe_media::parse_file_name(&file_name).ok_or(ApiError::NotFound)?;
    let id = id.to_string();
    let media = state.media.clone();
    let bytes = tokio::task::spawn_blocking(move || media.read(&id, size))
        .await
        .map_err(|_| ApiError::Internal)??
        .ok_or(ApiError::NotFound)?;
    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(response)
}
