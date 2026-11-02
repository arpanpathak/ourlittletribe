//! Pictures: covers for events, tribes and profiles, profile pictures, event
//! photos, pictures placed in descriptions, and serving the files.
//!
//! An upload arrives as the raw request body. It is decoded, resized and
//! re-encoded off the async threads, two at a time, which also strips its
//! EXIF data and GPS position.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, X_CONTENT_TYPE_OPTIONS};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tribe_db::activity_log::{self, About};
use tribe_db::events::{self, Event};
use tribe_db::ids::{EventId, ImageId, TribeId};
use tribe_db::images::{self, Attachment, CoverOf, NewImage, Photo};
use tribe_db::kinds::Action;
use tribe_db::tribes::{self, Tribe};
use tribe_db::unix_now;
use tribe_db::users::{self, ProfilePicture, User};
use tribe_media::{MediaError, Processed};

use super::access::{managed_event, member_event, require_organizer};
use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// A photo-sharing line in the feed is written at most once an hour per person and event.
const PHOTO_NOTE_SECONDS: i64 = 3600;

impl From<MediaError> for ApiError {
    fn from(error: MediaError) -> ApiError {
        match error {
            MediaError::NotAPicture => ApiError::Invalid("upload a JPEG, PNG, WebP or GIF picture"),
            MediaError::TooLarge => {
                ApiError::Invalid("that picture is too large (15 MB or 12,000 px at most)")
            }
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

/// A picture whose files are written, before anything refers to it.
struct StoredPicture {
    /// Its id, which names its files.
    id: ImageId,
    /// Width of the large copy, pixels.
    width: u32,
    /// Height of the large copy, pixels.
    height: u32,
}

/// Decodes, resizes and writes an upload.
async fn store_upload(state: &AppState, upload: Bytes) -> ApiResult<StoredPicture> {
    if upload.is_empty() {
        return Err(ApiError::Invalid("choose a picture to upload"));
    }
    if !state.limits.uploads.allow() {
        return Err(ApiError::TooMany);
    }
    let Ok(_permit) = state.picture_jobs.acquire().await else {
        return Err(ApiError::Internal);
    };

    let id = ImageId::random();
    let media = state.media.clone();
    let file_id = id.to_string();
    let processed = tokio::task::spawn_blocking(move || -> Result<Processed, MediaError> {
        let processed = tribe_media::process(&upload)?;
        media.save(&file_id, &processed)?;
        Ok(processed)
    })
    .await
    .map_err(|_| ApiError::Internal)??;

    Ok(StoredPicture {
        id,
        width: processed.width,
        height: processed.height,
    })
}

/// Deletes the files of pictures nothing refers to any more; failures are only logged.
fn delete_files(state: &AppState, ids: &[ImageId]) {
    for id in ids {
        if let Err(error) = state.media.remove(id.as_str()) {
            tracing::warn!(%error, %id, "could not delete a picture file");
        }
    }
}

/// Records what a stored picture is attached to. If that fails, its files are
/// deleted again. Returns the ids of covers it replaced.
async fn attach(
    state: &AppState,
    uploader: &User,
    attachment: Attachment,
    picture: &StoredPicture,
) -> ApiResult<Vec<ImageId>> {
    let image = NewImage {
        id: picture.id.clone(),
        uploader_id: uploader.id.clone(),
        attachment,
        width: picture.width,
        height: picture.height,
    };

    match state
        .db
        .call(move |connection| images::add(connection, &image))
        .await
    {
        Ok(replaced) => Ok(replaced),
        Err(error) => {
            delete_files(state, std::slice::from_ref(&picture.id));
            Err(error.into())
        }
    }
}

/// Stores an upload as the cover of `cover`, replacing any earlier one.
async fn set_cover(state: &AppState, user: &User, cover: CoverOf, upload: Bytes) -> ApiResult<()> {
    let picture = store_upload(state, upload).await?;
    let replaced = attach(state, user, Attachment::Cover(cover), &picture).await?;
    delete_files(state, &replaced);
    Ok(())
}

/// Removes the cover of `cover`, and its files.
async fn clear_cover(state: &AppState, cover: CoverOf) -> ApiResult<()> {
    let removed = state
        .db
        .call(move |connection| images::remove_cover(connection, &cover))
        .await?;
    delete_files(state, &removed);
    Ok(())
}

async fn event_after_change(
    state: &AppState,
    event_id: EventId,
    user: User,
) -> ApiResult<Json<Event>> {
    let event = state
        .db
        .call(move |connection| events::get(connection, &event_id, &user.id))
        .await?;
    Ok(Json(event))
}

async fn tribe_after_change(
    state: &AppState,
    tribe_id: TribeId,
    user: User,
) -> ApiResult<Json<Tribe>> {
    let tribe = state
        .db
        .call(move |connection| tribes::get(connection, &tribe_id, &user.id))
        .await?;
    Ok(Json(tribe))
}

/// `PUT /api/events/{event_id}/cover`: for the planner and the tribe's organizers.
pub async fn set_event_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    upload: Bytes,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    set_cover(&state, &user, CoverOf::Event(event_id.clone()), upload).await?;
    event_after_change(&state, event_id, user).await
}

/// `DELETE /api/events/{event_id}/cover`.
pub async fn remove_event_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    clear_cover(&state, CoverOf::Event(event_id.clone())).await?;
    event_after_change(&state, event_id, user).await
}

/// `PUT /api/tribes/{tribe_id}/cover`: for the tribe's organizers.
pub async fn set_tribe_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
    upload: Bytes,
) -> ApiResult<Json<Tribe>> {
    require_organizer(&state, &tribe_id, &user).await?;
    set_cover(&state, &user, CoverOf::Tribe(tribe_id.clone()), upload).await?;
    tribe_after_change(&state, tribe_id, user).await
}

/// `DELETE /api/tribes/{tribe_id}/cover`.
pub async fn remove_tribe_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(tribe_id): Path<TribeId>,
) -> ApiResult<Json<Tribe>> {
    require_organizer(&state, &tribe_id, &user).await?;
    clear_cover(&state, CoverOf::Tribe(tribe_id.clone())).await?;
    tribe_after_change(&state, tribe_id, user).await
}

/// Query of `POST /api/events/{event_id}/photos`.
#[derive(Deserialize)]
pub struct PhotoQuery {
    /// A line about the photo, at most 200 characters.
    #[serde(default)]
    caption: String,
}

/// Writes "shared photos" in the feed, unless the person did in the last hour.
fn note_photo_sharing(
    connection: &tribe_db::rusqlite::Connection,
    user: &User,
    event: &Event,
) -> tribe_db::DbResult<()> {
    let about = About::Event(event.id.clone());
    let since = unix_now() - PHOTO_NOTE_SECONDS;
    if activity_log::has_recent(connection, &user.id, Action::SharedPhoto, &about, since)? {
        return Ok(());
    }

    let summary = format!("{} shared photos from {}", user.name, event.title);
    activity_log::record(connection, &user.id, Action::SharedPhoto, &about, &summary)
}

/// `POST /api/events/{event_id}/photos?caption=…`: shares a photo; for members of the tribe.
pub async fn add_photo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Query(query): Query<PhotoQuery>,
    upload: Bytes,
) -> ApiResult<(StatusCode, Json<Vec<Photo>>)> {
    let caption = bounded(&query.caption, 200, "caption is too long")?;
    let event = member_event(&state, &event_id, &user).await?;

    let picture = store_upload(&state, upload).await?;
    attach(
        &state,
        &user,
        Attachment::EventPhoto {
            event_id: event_id.clone(),
            caption,
        },
        &picture,
    )
    .await?;

    let photos = state
        .db
        .call(move |connection| {
            note_photo_sharing(connection, &user, &event)?;
            images::photos(connection, &event_id)
        })
        .await?;
    Ok((StatusCode::CREATED, Json(photos)))
}

/// `DELETE /api/photos/{image_id}`: for whoever shared it, the event's planner and organizers.
pub async fn remove_photo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(image_id): Path<ImageId>,
) -> ApiResult<Json<Vec<Photo>>> {
    let lookup_id = image_id.clone();
    let record = state
        .db
        .call(move |connection| images::get(connection, &lookup_id))
        .await?;
    let Attachment::EventPhoto { event_id, .. } = record.attachment else {
        return Err(ApiError::NotFound);
    };

    let shared_it = record.uploader_id.as_ref() == Some(&user.id);
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
    delete_files(&state, &[record.id]);
    Ok(Json(photos))
}

/// Sets or clears one of the person's own pictures, and deletes the one it replaced.
async fn change_profile_picture(
    state: &AppState,
    user: User,
    which: ProfilePicture,
    upload: Option<Bytes>,
) -> ApiResult<Json<User>> {
    let picture = match upload {
        Some(upload) => Some(store_upload(state, upload).await?),
        None => None,
    };
    let new_id = picture.as_ref().map(|picture| picture.id.clone());

    let written = state
        .db
        .call(move |connection| {
            let replaced = users::set_picture(connection, &user.id, which, new_id.as_ref())?;
            Ok((replaced, users::get(connection, &user.id)?))
        })
        .await;

    match written {
        Ok((replaced, user)) => {
            delete_files(state, &replaced.into_iter().collect::<Vec<_>>());
            Ok(Json(user))
        }
        Err(error) => {
            if let Some(picture) = picture {
                delete_files(state, &[picture.id]);
            }
            Err(error.into())
        }
    }
}

/// `PUT /api/users/me/avatar`: your profile picture.
pub async fn set_avatar(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    upload: Bytes,
) -> ApiResult<Json<User>> {
    change_profile_picture(&state, user, ProfilePicture::Avatar, Some(upload)).await
}

/// `DELETE /api/users/me/avatar`.
pub async fn remove_avatar(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<User>> {
    change_profile_picture(&state, user, ProfilePicture::Avatar, None).await
}

/// `PUT /api/users/me/cover`: the banner on your profile.
pub async fn set_profile_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    upload: Bytes,
) -> ApiResult<Json<User>> {
    change_profile_picture(&state, user, ProfilePicture::Cover, Some(upload)).await
}

/// `DELETE /api/users/me/cover`.
pub async fn remove_profile_cover(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> ApiResult<Json<User>> {
    change_profile_picture(&state, user, ProfilePicture::Cover, None).await
}

/// A picture stored for placing in written text.
#[derive(Serialize)]
pub struct InlinePicture {
    /// Its id; the editor links `media/{id}.jpg`.
    id: ImageId,
    /// Width of the large copy, pixels.
    width: u32,
    /// Height of the large copy, pixels.
    height: u32,
}

/// `POST /api/pictures`: stores a picture to place in a description.
pub async fn add_inline(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    upload: Bytes,
) -> ApiResult<(StatusCode, Json<InlinePicture>)> {
    let picture = store_upload(&state, upload).await?;
    let picture_id = picture.id.clone();

    let written = state
        .db
        .call(move |connection| images::add_inline(connection, &picture_id, &user.id))
        .await;
    if let Err(error) = written {
        delete_files(&state, &[picture.id]);
        return Err(error.into());
    }

    Ok((
        StatusCode::CREATED,
        Json(InlinePicture {
            id: picture.id,
            width: picture.width,
            height: picture.height,
        }),
    ))
}

/// `GET /media/{file}`: a stored picture, `{id}.jpg` or `{id}_s.jpg`, for signed-in people.
pub async fn serve(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Path(file_name): Path<String>,
) -> ApiResult<Response> {
    let file = tribe_media::parse_file_name(&file_name).ok_or(ApiError::NotFound)?;
    let id = file.id.to_string();
    let size = file.size;

    let media = state.media.clone();
    let bytes = tokio::task::spawn_blocking(move || media.read(&id, size))
        .await
        .map_err(|_| ApiError::Internal)??
        .ok_or(ApiError::NotFound)?;

    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(response)
}
