//! Drafts the model writes for people to check: an event or a tribe filled in from their
//! own words, descriptions, and cover scenes.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use tribe_brain::covers::{CoverDesign, CoverFor, CoverSubject};
use tribe_brain::drafting::TribeDraft;
use tribe_brain::places::PlaceGuess;
use tribe_core::geo::LatLng;
use tribe_core::itinerary::StopKind;
use tribe_places::address::PlaceMatch;

use super::{bounded, model};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::place_search;
use crate::state::AppState;

/// Body of `POST /api/event-drafts`.
#[derive(Deserialize)]
pub struct EventDraftRequest {
    /// What the person said or typed, 5 to 2,000 characters.
    text: String,
    /// Their local date and time, such as "Saturday 2026-10-31 13:05".
    today: String,
    /// Where they are, to settle place names; optional.
    #[serde(default)]
    near: Option<LatLng>,
}

/// A place in the draft: what the model named, and the real place found for it.
#[derive(Serialize)]
pub struct DraftPlace {
    /// The name and area the model gave, to search for when no place was found.
    query: String,
    /// The real place, when the map has one.
    place: Option<PlaceMatch>,
}

/// Another place in the draft.
#[derive(Serialize)]
pub struct DraftStop {
    /// What it is for.
    kind: StopKind,
    /// A few words from what the person said about it.
    note: String,
    /// Where it is; its fields sit beside `kind` and `note` in JSON.
    #[serde(flatten)]
    found: DraftPlace,
}

/// The form as the model filled it in.
#[derive(Serialize)]
pub struct EventDraft {
    /// Title.
    title: String,
    /// A Markdown description.
    description: String,
    /// `YYYY-MM-DD`, when they said a day.
    date: Option<String>,
    /// `HH:MM`, when they said a time.
    time: Option<String>,
    /// Where everyone meets, when they said.
    meeting_point: Option<DraftPlace>,
    /// Other places, in order.
    stops: Vec<DraftStop>,
}

fn query_of(guess: &PlaceGuess) -> String {
    match guess.area.is_empty() {
        true => guess.name.clone(),
        false => format!("{}, {}", guess.name, guess.area),
    }
}

/// Looks every guess up at once; each becomes a real place, or `None`.
async fn resolve_all(
    state: &AppState,
    guesses: Vec<PlaceGuess>,
    near: Option<LatLng>,
) -> Vec<Option<PlaceMatch>> {
    let mut lookups = JoinSet::new();
    for (index, guess) in guesses.into_iter().enumerate() {
        let state = state.clone();
        lookups.spawn(async move { (index, place_search::resolve(&state, guess, near).await) });
    }

    let mut found = Vec::new();
    while let Some(Ok(result)) = lookups.join_next().await {
        found.push(result);
    }
    found.sort_by_key(|(index, _)| *index);
    found.into_iter().map(|(_, place)| place).collect()
}

/// `POST /api/event-drafts`: fills in an event from what someone said. Nothing
/// is saved; the page puts the draft in the form for the person to check.
pub async fn event_draft(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<EventDraftRequest>,
) -> ApiResult<(StatusCode, Json<EventDraft>)> {
    let brain = model(&state)?;
    let text = bounded(
        &request.text,
        2000,
        "that is too long; keep it under 2,000 characters",
    )?;
    if text.chars().count() < 5 {
        return Err(ApiError::Invalid("say a little about the plan first"));
    }
    let today = bounded(&request.today, 60, "date is too long")?;
    let near = request
        .near
        .and_then(|point| LatLng::new(point.lat, point.lng));

    let region = match near {
        Some(point) => place_search::region_name(&state, point).await,
        None => None,
    };
    let draft = brain.draft_event(&text, &today, region.as_deref()).await?;

    let mut guesses: Vec<PlaceGuess> = draft.meeting_point.iter().cloned().collect();
    guesses.extend(draft.stops.iter().map(|stop| stop.place.clone()));
    let mut found = resolve_all(&state, guesses, near).await.into_iter();

    let meeting_point = draft.meeting_point.map(|guess| DraftPlace {
        query: query_of(&guess),
        place: found.next().flatten(),
    });
    let stops = draft
        .stops
        .into_iter()
        .map(|stop| DraftStop {
            kind: stop.kind,
            note: stop.note,
            found: DraftPlace {
                query: query_of(&stop.place),
                place: found.next().flatten(),
            },
        })
        .collect();

    let filled = EventDraft {
        title: draft.title,
        description: draft.description,
        date: draft.date,
        time: draft.time,
        meeting_point,
        stops,
    };
    Ok((StatusCode::CREATED, Json(filled)))
}

/// Body of `POST /api/description-drafts`.
#[derive(Deserialize)]
pub struct DescriptionRequest {
    /// Lines about the event or tribe, such as "Title: Skyline loop"; at most 20.
    #[serde(default)]
    details: Vec<String>,
    /// The text so far, at most 8,000 characters.
    #[serde(default)]
    current: String,
    /// What to do, such as "make it shorter", at most 500 characters.
    instruction: String,
}

/// The model's new text.
#[derive(Serialize)]
pub struct DescriptionDraft {
    /// The whole new description, in Markdown.
    text: String,
}

/// `POST /api/description-drafts`: writes or rewrites a description as told.
pub async fn description_draft(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<DescriptionRequest>,
) -> ApiResult<(StatusCode, Json<DescriptionDraft>)> {
    let brain = model(&state)?;
    if request.details.len() > 20 {
        return Err(ApiError::Invalid("too many details"));
    }

    let details = request
        .details
        .iter()
        .map(|line| bounded(line, 300, "a detail is too long"))
        .collect::<ApiResult<Vec<String>>>()?;
    let current = bounded(&request.current, 8000, "the description is too long")?;
    let instruction = bounded(&request.instruction, 500, "the instruction is too long")?;
    if instruction.is_empty() {
        return Err(ApiError::Invalid("say what to write"));
    }

    let text = brain
        .write_description(&details, &current, &instruction)
        .await?;
    Ok((StatusCode::CREATED, Json(DescriptionDraft { text })))
}

/// Body of `POST /api/tribe-drafts`.
#[derive(Deserialize)]
pub struct TribeDraftRequest {
    /// What the person said or typed about the group, 5 to 2,000 characters.
    text: String,
}

/// `POST /api/tribe-drafts`: fills in a new tribe from what someone said.
/// Nothing is saved; the page puts the draft in the form.
pub async fn tribe_draft(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<TribeDraftRequest>,
) -> ApiResult<(StatusCode, Json<TribeDraft>)> {
    let brain = model(&state)?;
    let text = bounded(
        &request.text,
        2000,
        "that is too long; keep it under 2,000 characters",
    )?;
    if text.chars().count() < 5 {
        return Err(ApiError::Invalid("say a little about the group first"));
    }

    let draft = brain.draft_tribe(&text).await?;
    Ok((StatusCode::CREATED, Json(draft)))
}

/// Body of `POST /api/cover-designs`.
#[derive(Deserialize)]
pub struct CoverDesignRequest {
    /// A tribe or an event.
    subject: CoverFor,
    /// Its name or title, at most 120 characters.
    title: String,
    /// Its description so far, at most 8,000 characters.
    #[serde(default)]
    description: String,
    /// Where it happens or meets, at most 160 characters.
    #[serde(default)]
    place: String,
    /// When it happens, such as "Saturday 7 November 2026", at most 60 characters.
    #[serde(default)]
    when: String,
}

/// Some text, or `None` when it is blank.
fn given(text: &str) -> Option<&str> {
    Some(text).filter(|text| !text.is_empty())
}

/// `POST /api/cover-designs`: has the model choose a cover scene. The page
/// draws the scene and uploads the picture as the cover.
pub async fn cover_design(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<CoverDesignRequest>,
) -> ApiResult<(StatusCode, Json<CoverDesign>)> {
    let brain = model(&state)?;
    let title = bounded(&request.title, 120, "the name is too long")?;
    if title.is_empty() {
        return Err(ApiError::Invalid("give it a name first"));
    }
    let description = bounded(&request.description, 8000, "the description is too long")?;
    let place = bounded(&request.place, 160, "the place is too long")?;
    let when = bounded(&request.when, 60, "the date is too long")?;

    let subject = CoverSubject {
        kind: request.subject,
        title: &title,
        description: &description,
        place: given(&place),
        when: given(&when),
    };
    let design = brain.design_cover(&subject).await?;
    Ok((StatusCode::CREATED, Json(design)))
}
