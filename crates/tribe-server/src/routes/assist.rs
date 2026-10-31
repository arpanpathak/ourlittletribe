//! The model as a writing helper: filling in an event from someone's own
//! words, and writing or rewriting descriptions.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use tribe_brain::{Brain, PlaceGuess};
use tribe_core::geo::LatLng;
use tribe_places::photon::PlaceMatch;

use super::bounded;
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::place_search;
use crate::state::AppState;

fn brain(state: &AppState) -> ApiResult<Arc<Brain>> {
    state.brain.clone().ok_or(ApiError::NoModel)
}

/// Body of a draft request.
#[derive(Deserialize)]
pub struct DraftRequest {
    text: String,
    /// The person's local date and time, such as "Saturday 2026-10-31 13:05".
    today: String,
    lat: Option<f64>,
    lng: Option<f64>,
}

/// A place from the draft: what the model named, and the real place found for it.
#[derive(Serialize)]
pub struct DraftPlace {
    query: String,
    place: Option<PlaceMatch>,
}

/// Another place in the draft.
#[derive(Serialize)]
pub struct DraftStopView {
    kind: String,
    note: String,
    #[serde(flatten)]
    found: DraftPlace,
}

/// The form as the model filled it in.
#[derive(Serialize)]
pub struct DraftView {
    title: String,
    description: String,
    date: String,
    time: String,
    meeting: Option<DraftPlace>,
    stops: Vec<DraftStopView>,
}

fn query_of(guess: &PlaceGuess) -> String {
    match guess.area.is_empty() {
        true => guess.name.clone(),
        false => format!("{}, {}", guess.name, guess.area),
    }
}

/// `POST /api/assist/event-draft`: fills in an event from what someone said.
pub async fn event_draft(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<DraftRequest>,
) -> ApiResult<Json<DraftView>> {
    let brain = brain(&state)?;
    let text = bounded(
        &request.text,
        2000,
        "that's too long; keep it under 2,000 characters",
    )?;
    if text.chars().count() < 5 {
        return Err(ApiError::Invalid("say a little about the plan first"));
    }
    let today = bounded(&request.today, 60, "date is too long")?;
    let near = match (request.lat, request.lng) {
        (Some(lat), Some(lng)) => LatLng::new(lat, lng),
        _ => None,
    };
    let region = match near {
        Some(point) => place_search::region_name(&state, point).await,
        None => None,
    };
    let draft = brain.draft_event(&text, &today, region.as_deref()).await?;

    // Look every place up at once; each becomes a real point on the map, or stays a search.
    let mut guesses = vec![draft.meeting_point.clone()];
    guesses.extend(draft.stops.iter().map(|stop| stop.place.clone()));
    let mut lookups = JoinSet::new();
    for (index, guess) in guesses.iter().cloned().enumerate() {
        let state = state.clone();
        lookups.spawn(async move { (index, place_search::resolve(&state, guess, near).await) });
    }
    let mut found: Vec<Option<PlaceMatch>> = vec![None; guesses.len()];
    while let Some(joined) = lookups.join_next().await {
        if let Ok((index, place)) = joined {
            found[index] = place;
        }
    }
    let mut found = found.into_iter();
    let meeting_place = found.next().flatten();
    let meeting = match draft.meeting_point.name.is_empty() {
        true => None,
        false => Some(DraftPlace {
            query: query_of(&draft.meeting_point),
            place: meeting_place,
        }),
    };
    let stops = draft
        .stops
        .into_iter()
        .zip(found)
        .map(|(stop, place)| DraftStopView {
            kind: stop.kind,
            note: stop.note,
            found: DraftPlace {
                query: query_of(&stop.place),
                place,
            },
        })
        .collect();
    Ok(Json(DraftView {
        title: draft.title,
        description: draft.description,
        date: draft.date,
        time: draft.time,
        meeting,
        stops,
    }))
}

/// Body of a writing request.
#[derive(Deserialize)]
pub struct WriteRequest {
    /// Lines about the event or tribe, such as "Title: Skyline loop".
    #[serde(default)]
    details: Vec<String>,
    #[serde(default)]
    current: String,
    instruction: String,
}

/// The new text.
#[derive(Serialize)]
pub struct Written {
    text: String,
}

/// `POST /api/assist/description`: writes or rewrites a description as instructed.
pub async fn description(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<WriteRequest>,
) -> ApiResult<Json<Written>> {
    let brain = brain(&state)?;
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
    Ok(Json(Written { text }))
}
