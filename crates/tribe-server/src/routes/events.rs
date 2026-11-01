//! Events: list, plan, view, change, delete; answers, votes and starting points.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tribe_core::basket::{Basket, EvidenceThreshold, Pairing, bought_with};
use tribe_core::geo::LatLng;
use tribe_core::itinerary::{Place, StopKind};
use tribe_db::activity_log::{self, About};
use tribe_db::events::{self, Attendee, Event, EventPlan, Vote};
use tribe_db::ids::{EventId, TribeId};
use tribe_db::images::{self, Photo};
use tribe_db::kinds::{Action, Rsvp};
use tribe_db::prep::{self, PrepItem};
use tribe_db::stops::{self, NewStop, Stop};
use tribe_db::users::User;
use tribe_db::{tribes, unix_now};

use super::access::{can_manage, event_for, managed_event, require_member};
use super::bounded;
use crate::auth::CurrentUser;
use crate::conditions::{self, Conditions};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Events stay in "upcoming" until six hours after they start.
const STILL_UPCOMING_SECONDS: i64 = 6 * 3600;

/// An event can start at most this long ago when it is planned or changed.
const START_GRACE_SECONDS: i64 = 3600;

/// Places besides the meeting point, at most.
const MOST_STOPS: usize = 16;

/// Pairings shown under each item, at most.
const PAIRINGS_PER_ITEM: usize = 3;

/// Query of `GET /api/events`.
#[derive(Deserialize)]
pub struct EventFilter {
    /// Only this tribe's events, when given.
    tribe: Option<TribeId>,
}

/// `GET /api/events?tribe=…`: upcoming events, soonest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(filter): Query<EventFilter>,
) -> ApiResult<Json<Vec<Event>>> {
    let cutoff = unix_now() - STILL_UPCOMING_SECONDS;
    let found = state
        .db
        .call(move |connection| {
            events::upcoming(connection, &user.id, filter.tribe.as_ref(), cutoff, 100)
        })
        .await?;
    Ok(Json(found))
}

/// What a planner fills in, when planning an event or changing it.
#[derive(Deserialize)]
pub struct EventFields {
    /// Title, 1 to 120 characters.
    title: String,
    /// What the plan is, in Markdown, at most 8,000 characters.
    #[serde(default)]
    description: String,
    /// Where everyone gathers first.
    meeting_point: Place,
    /// Start time, Unix seconds.
    starts_at: i64,
    /// The meeting place's offset from UTC, minutes.
    #[serde(default)]
    tz_offset_minutes: i64,
    /// The other places, in order; leaving it out keeps the current ones.
    #[serde(default)]
    stops: Option<Vec<NewStop>>,
}

/// An event's plan and its stops, checked.
struct CheckedFields {
    /// The plan.
    plan: EventPlan,
    /// The stops, when they were sent.
    stops: Option<Vec<NewStop>>,
}

fn checked_place(place: Place, problem: &'static str) -> ApiResult<Place> {
    let name = bounded(&place.name, 200, "a place name is too long")?;
    if name.is_empty() {
        return Err(ApiError::Invalid(problem));
    }
    let point = LatLng::new(place.point.lat, place.point.lng)
        .ok_or(ApiError::Invalid("a place is not on the map"))?;
    Ok(Place { name, point })
}

fn checked_stops(stops: Vec<NewStop>) -> ApiResult<Vec<NewStop>> {
    if stops.len() > MOST_STOPS {
        return Err(ApiError::Invalid(
            "an event can have at most 16 places besides the meeting point",
        ));
    }

    let venues = stops
        .iter()
        .filter(|stop| stop.kind == StopKind::Venue)
        .count();
    if venues > 1 {
        return Err(ApiError::Invalid("an event has one venue at most"));
    }

    let mut checked = stops
        .into_iter()
        .map(|stop| {
            Ok(NewStop {
                kind: stop.kind,
                place: checked_place(stop.place, "every stop needs a place")?,
                note: bounded(&stop.note, 200, "a stop's note is too long")?,
            })
        })
        .collect::<ApiResult<Vec<NewStop>>>()?;

    checked.sort_by_key(|stop| stop.kind.stage());
    Ok(checked)
}

impl EventFields {
    fn checked(self) -> ApiResult<CheckedFields> {
        let title = bounded(&self.title, 120, "title is too long")?;
        if title.is_empty() {
            return Err(ApiError::Invalid("give the event a title"));
        }
        if self.starts_at < unix_now() - START_GRACE_SECONDS {
            return Err(ApiError::Invalid("the start time is in the past"));
        }
        if !(-14 * 60..=14 * 60).contains(&self.tz_offset_minutes) {
            return Err(ApiError::Invalid("time zone offset is out of range"));
        }

        let plan = EventPlan {
            title,
            description: bounded(&self.description, 8000, "description is too long")?,
            meeting_point: checked_place(self.meeting_point, "say where to meet")?,
            starts_at: self.starts_at,
            tz_offset_minutes: self.tz_offset_minutes,
        };
        let stops = self.stops.map(checked_stops).transpose()?;
        Ok(CheckedFields { plan, stops })
    }
}

/// Body of `POST /api/events`.
#[derive(Deserialize)]
pub struct NewEventForm {
    /// The tribe it belongs to; you must be a member.
    tribe_id: TribeId,
    /// What it says.
    #[serde(flatten)]
    fields: EventFields,
}

/// `POST /api/events`: plans an event in one of your tribes.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(form): Json<NewEventForm>,
) -> ApiResult<(StatusCode, Json<Event>)> {
    require_member(&state, &form.tribe_id, &user).await?;
    let checked = form.fields.checked()?;
    let tribe_id = form.tribe_id;

    let event = state
        .db
        .call(move |connection| {
            let event = events::create(connection, &tribe_id, &user.id, &checked.plan)?;
            stops::replace(connection, &event.id, &checked.stops.unwrap_or_default())?;

            let summary = format!("{} planned {}", user.name, event.title);
            activity_log::record(
                connection,
                &user.id,
                Action::PlannedEvent,
                &About::Event(event.id.clone()),
                &summary,
            )?;
            Ok(event)
        })
        .await?;

    Ok((StatusCode::CREATED, Json(event)))
}

/// `PATCH /api/events/{event_id}`: for the planner and the tribe's organizers.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Json(fields): Json<EventFields>,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    let checked = fields.checked()?;
    let changed_id = event_id.clone();

    let event = state
        .db
        .call(move |connection| {
            let event = events::update(connection, &event_id, &user.id, &checked.plan)?;
            if let Some(new_stops) = checked.stops {
                stops::replace(connection, &event_id, &new_stops)?;
            }
            Ok(event)
        })
        .await?;

    state.caches.forget_event(&changed_id);
    Ok(Json(event))
}

/// An item on the list, with what earlier groups bought alongside it.
#[derive(Serialize)]
pub struct ItemView {
    /// The item; its fields sit beside `often_with` in JSON.
    #[serde(flatten)]
    item: PrepItem,
    /// Items groups bought with it, once there is enough evidence.
    often_with: Vec<Pairing>,
}

/// Everything the event page shows.
#[derive(Serialize)]
pub struct EventDetail {
    /// The event.
    event: Event,
    /// Its other places, in order.
    stops: Vec<Stop>,
    /// Everyone going.
    attendees: Vec<Attendee>,
    /// The packing list.
    items: Vec<ItemView>,
    /// Forecast and elevation where it happens.
    conditions: Conditions,
    /// Shared photos, newest first.
    photos: Vec<Photo>,
    /// Where you said you start from.
    my_origin: Option<LatLng>,
    /// Whether you belong to its tribe.
    is_member: bool,
    /// Whether you may change it.
    can_manage: bool,
    /// Whether the model is set up, so its features can be offered.
    model_ready: bool,
}

/// What the database holds for an event page.
struct StoredDetail {
    /// The other places, in order.
    stops: Vec<Stop>,
    /// Everyone going.
    attendees: Vec<Attendee>,
    /// The packing list.
    items: Vec<PrepItem>,
    /// Every finished list, for pairings.
    baskets: Vec<Basket>,
    /// Shared photos.
    photos: Vec<Photo>,
    /// Where the viewer starts from.
    origin: Option<LatLng>,
    /// Whether the viewer belongs to the tribe.
    is_member: bool,
}

fn with_pairings(items: Vec<PrepItem>, baskets: &[Basket]) -> Vec<ItemView> {
    items
        .into_iter()
        .map(|item| {
            let mut often_with = bought_with(baskets, &item.name, EvidenceThreshold::default());
            often_with.truncate(PAIRINGS_PER_ITEM);
            ItemView { item, often_with }
        })
        .collect()
}

/// `GET /api/events/{event_id}`: the whole event page.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<Json<EventDetail>> {
    let event = event_for(&state, &event_id, &user).await?;
    let tribe_id = event.tribe_id.clone();
    let viewer_id = user.id.clone();

    let stored = state
        .db
        .call(move |connection| {
            Ok(StoredDetail {
                stops: stops::for_event(connection, &event_id)?,
                attendees: events::attendees(connection, &event_id)?,
                items: prep::list(connection, &event_id)?,
                baskets: prep::baskets(connection)?,
                photos: images::photos(connection, &event_id)?,
                origin: events::origin(connection, &event_id, &viewer_id)?,
                is_member: tribes::role_of(connection, &tribe_id, &viewer_id)?.is_some(),
            })
        })
        .await?;

    Ok(Json(EventDetail {
        conditions: conditions::for_event(&state, &event).await,
        can_manage: can_manage(&state, &event, &user).await?,
        model_ready: state.brain.is_some(),
        items: with_pairings(stored.items, &stored.baskets),
        stops: stored.stops,
        attendees: stored.attendees,
        photos: stored.photos,
        my_origin: stored.origin,
        is_member: stored.is_member,
        event,
    }))
}

/// `DELETE /api/events/{event_id}`: for the planner and the tribe's organizers.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<StatusCode> {
    managed_event(&state, &event_id, &user).await?;
    state
        .db
        .call(move |connection| events::delete(connection, &event_id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Body of `PUT /api/events/{event_id}/rsvp`.
#[derive(Deserialize)]
pub struct RsvpForm {
    /// `going` or `not_going`.
    answer: Rsvp,
}

/// `PUT /api/events/{event_id}/rsvp`: your answer. Going joins you to the
/// tribe; not going forgets where you start from.
pub async fn set_rsvp(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Json(form): Json<RsvpForm>,
) -> ApiResult<Json<Event>> {
    let event = state
        .db
        .call(move |connection| {
            let before = events::get(connection, &event_id, &user.id)?;
            tribes::join(connection, &before.tribe_id, &user.id)?;
            events::set_rsvp(connection, &event_id, &user.id, form.answer)?;

            match (form.answer, before.my_rsvp) {
                (Rsvp::Going, Some(Rsvp::Going)) => {}
                (Rsvp::Going, _) => {
                    let summary = format!("{} is going to {}", user.name, before.title);
                    activity_log::record(
                        connection,
                        &user.id,
                        Action::Going,
                        &About::Event(event_id.clone()),
                        &summary,
                    )?;
                }
                (Rsvp::NotGoing, _) => events::clear_origin(connection, &event_id, &user.id)?,
            }

            events::get(connection, &event_id, &user.id)
        })
        .await?;
    Ok(Json(event))
}

/// Body of `PUT /api/events/{event_id}/vote`.
#[derive(Deserialize)]
pub struct VoteForm {
    /// `up` or `down`.
    vote: Vote,
}

async fn store_vote(
    state: &AppState,
    event_id: EventId,
    user: User,
    vote: Option<Vote>,
) -> ApiResult<Event> {
    let event = state
        .db
        .call(move |connection| {
            events::get(connection, &event_id, &user.id)?;
            events::set_vote(connection, &event_id, &user.id, vote)?;
            events::get(connection, &event_id, &user.id)
        })
        .await?;
    Ok(event)
}

/// `PUT /api/events/{event_id}/vote`: a thumbs up or down.
pub async fn set_vote(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Json(form): Json<VoteForm>,
) -> ApiResult<Json<Event>> {
    Ok(Json(
        store_vote(&state, event_id, user, Some(form.vote)).await?,
    ))
}

/// `DELETE /api/events/{event_id}/vote`: takes your vote back.
pub async fn remove_vote(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<Json<Event>> {
    Ok(Json(store_vote(&state, event_id, user, None).await?))
}

/// `PUT /api/events/{event_id}/origin`: where you set off from, for finding
/// stores on your way. It is deleted a day after the event.
pub async fn set_origin(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Json(origin): Json<LatLng>,
) -> ApiResult<Json<LatLng>> {
    let point = LatLng::new(origin.lat, origin.lng)
        .ok_or(ApiError::Invalid("that point is not on the map"))?;

    state
        .db
        .call(move |connection| {
            events::get(connection, &event_id, &user.id)?;
            events::set_origin(connection, &event_id, &user.id, point)
        })
        .await?;
    Ok(Json(point))
}

/// `DELETE /api/events/{event_id}/origin`: forgets where you set off from.
pub async fn clear_origin(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<StatusCode> {
    state
        .db
        .call(move |connection| events::clear_origin(connection, &event_id, &user.id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
