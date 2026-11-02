//! Drafts the model writes for people to check: an event or a tribe filled in from their
//! own words, descriptions, and cover scenes.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use tribe_brain::Brain;
use tribe_brain::covers::{CoverFor, CoverSubject};
use tribe_brain::drafting::{self, TribeDraft};
use tribe_brain::places::PlaceGuess;
use tribe_core::geo::LatLng;
use tribe_core::itinerary::StopKind;
use tribe_db::ids::TribeId;
use tribe_db::tribes::{self, Tribe};
use tribe_places::address::PlaceMatch;
use tribe_places::facilities::OsmTag;

use super::{bounded, model};
use crate::auth::CurrentUser;
use crate::draft_facts::{Planned, draft_facts};
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
    /// The person's tribe the event belongs in, when the model chose one.
    tribe_id: Option<TribeId>,
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

/// What to put in the search box for a guess, such as "Rattlesnake Ledge,
/// North Bend", or "Cafe in Snoqualmie" for a kind of place in a town.
fn query_of(guess: &PlaceGuess) -> String {
    if let Some(tag) = OsmTag::parse(&guess.facility) {
        return format!("{} in {}", tag.plain_name(), guess.name);
    }

    match guess.area.is_empty() {
        true => guess.name.clone(),
        false => format!("{}, {}", guess.name, guess.area),
    }
}

/// Looks every guess up at once; each becomes a real place, or `None`.
async fn resolve_all(
    state: &AppState,
    guesses: Vec<PlaceGuess>,
    said: &str,
    near: Option<LatLng>,
) -> Vec<Option<PlaceMatch>> {
    let mut lookups = JoinSet::new();
    for (index, guess) in guesses.into_iter().enumerate() {
        let state = state.clone();
        let said = said.to_string();
        lookups.spawn(async move {
            let place = place_search::resolve(&state, guess, &said, near).await;
            (index, place)
        });
    }

    let mut found = Vec::new();
    while let Some(Ok(result)) = lookups.join_next().await {
        found.push(result);
    }
    found.sort_by_key(|(index, _)| *index);
    found.into_iter().map(|(_, place)| place).collect()
}

/// The description, written from what they said and the facts found for
/// the plan; empty when the model fails, so the rest of the draft still
/// reaches the form.
async fn describe(
    state: &AppState,
    brain: &Brain,
    said: &str,
    draft: &drafting::EventDraft,
    meeting_point: Option<&DraftPlace>,
    stops: &[DraftStop],
) -> String {
    let mut planned: Vec<Planned> = Vec::new();
    if let Some(meeting) = meeting_point {
        planned.push(Planned {
            kind: None,
            query: &meeting.query,
            place: meeting.place.as_ref(),
            note: "",
        });
    }
    for stop in stops {
        planned.push(Planned {
            kind: Some(stop.kind),
            query: &stop.found.query,
            place: stop.found.place.as_ref(),
            note: &stop.note,
        });
    }

    let facts = draft_facts(
        state,
        draft.date.as_deref(),
        draft.time.as_deref(),
        &planned,
    )
    .await;
    tracing::debug!(?facts, "facts for a drafted description");

    match brain.describe_event(said, &facts).await {
        Ok(description) => description,
        Err(error) => {
            tracing::warn!(%error, "the model could not write the description");
            String::new()
        }
    }
}

/// `POST /api/event-drafts`: fills in an event from what someone said. Nothing
/// is saved; the page puts the draft in the form for the person to check.
pub async fn event_draft(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
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
    let viewer_id = user.id.clone();
    let all_tribes = state
        .db
        .call(move |connection| tribes::list(connection, &viewer_id))
        .await?;
    let my_tribes: Vec<Tribe> = all_tribes
        .into_iter()
        .filter(|tribe| tribe.is_member)
        .collect();
    let tribe_names: Vec<String> = my_tribes.iter().map(|tribe| tribe.name.clone()).collect();

    let draft = brain
        .draft_event(&text, &today, region.as_deref(), &tribe_names)
        .await?;
    let tribe_id = draft
        .tribe
        .as_ref()
        .and_then(|name| my_tribes.iter().find(|tribe| &tribe.name == name))
        .map(|tribe| tribe.id.clone());

    // The meeting point is found first. Its position then stands for where
    // the group is, so a stop's name cannot match a town of the same name
    // far away, even when the browser did not share the person's location.
    let meeting_place = match draft.meeting_point.clone() {
        Some(guess) => place_search::resolve(&state, guess, &text, near).await,
        None => None,
    };
    let around = near.or(meeting_place.as_ref().map(|place| place.location));

    let guesses: Vec<PlaceGuess> = draft.stops.iter().map(|stop| stop.place.clone()).collect();
    let mut found = resolve_all(&state, guesses, &text, around)
        .await
        .into_iter();

    let meeting_point = draft.meeting_point.as_ref().map(|guess| DraftPlace {
        query: query_of(guess),
        place: meeting_place,
    });
    let stops: Vec<DraftStop> = draft
        .stops
        .iter()
        .cloned()
        .map(|stop| DraftStop {
            kind: stop.kind,
            note: stop.note,
            found: DraftPlace {
                query: query_of(&stop.place),
                place: found.next().flatten(),
            },
        })
        .collect();

    let description = describe(
        &state,
        &brain,
        &text,
        &draft,
        meeting_point.as_ref(),
        &stops,
    )
    .await;

    let filled = EventDraft {
        tribe_id,
        title: draft.title,
        description,
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

/// Body of `POST /api/cover-scenes`.
#[derive(Deserialize)]
pub struct CoverSceneRequest {
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

/// A scene for a cover, in words, for the person to read and change.
#[derive(Serialize)]
pub struct CoverScene {
    /// The description of the scene.
    scene: String,
}

/// Some text, or `None` when it is blank.
fn given(text: &str) -> Option<&str> {
    Some(text).filter(|text| !text.is_empty())
}

/// `POST /api/cover-scenes`: has the model describe a cover scene for a
/// tribe or event. The page shows it to edit, then asks for a drawing.
pub async fn cover_scene(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<CoverSceneRequest>,
) -> ApiResult<(StatusCode, Json<CoverScene>)> {
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
    let scene = brain.describe_cover(&subject).await?;
    Ok((StatusCode::CREATED, Json(CoverScene { scene })))
}
