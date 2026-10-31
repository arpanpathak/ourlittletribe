//! Events: list, plan, view, RSVP, vote, and each person's starting point.

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};
use tribe_core::basket::{EvidenceThreshold, Pairing, bought_with};
use tribe_core::geo::LatLng;
use tribe_db::events::{self, Attendee, Event, NewEvent};
use tribe_db::images::{self, Photo};
use tribe_db::prep::{self, PrepItem};
use tribe_db::stops::{self, NewStop, Stop, StopKind};
use tribe_db::{activity_log, tribes, unix_now};

use super::{bounded, managed_event, require_member};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::trip::{self, Conditions};

/// Filter for the event list.
#[derive(Deserialize)]
pub struct EventFilter {
    tribe: Option<String>,
}

/// `GET /api/events?tribe=…`: upcoming events, soonest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(filter): Query<EventFilter>,
) -> ApiResult<Json<Vec<Event>>> {
    let found = state
        .db
        .call(move |connection| {
            events::upcoming(
                connection,
                &user.id,
                filter.tribe.as_deref(),
                unix_now() - 6 * 3600,
                100,
            )
        })
        .await?;
    Ok(Json(found))
}

/// What an event says: filled in when planning it and when editing it.
#[derive(Deserialize)]
pub struct EventFields {
    title: String,
    #[serde(default)]
    description: String,
    place_name: String,
    lat: f64,
    lng: f64,
    starts_at: i64,
    #[serde(default)]
    tz_offset_minutes: i64,
    /// Other places the event goes, in order; `None` leaves them as they are.
    #[serde(default)]
    stops: Option<Vec<StopFields>>,
}

/// One stop as the form sends it.
#[derive(Deserialize)]
pub struct StopFields {
    kind: StopKind,
    name: String,
    lat: f64,
    lng: f64,
    #[serde(default)]
    note: String,
}

/// Most stops one event may have.
const MOST_STOPS: usize = 12;

fn validated_stops(stops: Vec<StopFields>) -> ApiResult<Vec<NewStop>> {
    if stops.len() > MOST_STOPS {
        return Err(ApiError::Invalid("an event can have at most 12 stops"));
    }
    if stops
        .iter()
        .filter(|stop| stop.kind == StopKind::Venue)
        .count()
        > 1
    {
        return Err(ApiError::Invalid("an event has one venue at most"));
    }
    stops
        .into_iter()
        .map(|stop| {
            let name = bounded(&stop.name, 200, "a stop's name is too long")?;
            if name.is_empty() {
                return Err(ApiError::Invalid("every stop needs a place"));
            }
            let point = LatLng::new(stop.lat, stop.lng)
                .ok_or(ApiError::Invalid("a stop is not on the map"))?;
            Ok(NewStop {
                kind: stop.kind,
                name,
                lat: point.lat,
                lng: point.lng,
                note: bounded(&stop.note, 200, "a stop's note is too long")?,
            })
        })
        .collect()
}

impl EventFields {
    /// Checks every field and returns them trimmed, with the stops when they were sent.
    fn validated(self) -> ApiResult<(NewEvent, Option<Vec<NewStop>>)> {
        let stops = match self.stops {
            Some(stops) => Some(validated_stops(stops)?),
            None => None,
        };
        let title = bounded(&self.title, 120, "title is too long")?;
        if title.is_empty() {
            return Err(ApiError::Invalid("give the event a title"));
        }
        let place_name = bounded(&self.place_name, 200, "place name is too long")?;
        if place_name.is_empty() {
            return Err(ApiError::Invalid("say where to meet"));
        }
        let point = LatLng::new(self.lat, self.lng)
            .ok_or(ApiError::Invalid("pick the meeting point on the map"))?;
        if self.starts_at < unix_now() - 3600 {
            return Err(ApiError::Invalid("the start time is in the past"));
        }
        if !(-14 * 60..=14 * 60).contains(&self.tz_offset_minutes) {
            return Err(ApiError::Invalid("time zone offset is out of range"));
        }
        let event = NewEvent {
            title,
            description: bounded(&self.description, 8000, "description is too long")?,
            place_name,
            lat: point.lat,
            lng: point.lng,
            starts_at: self.starts_at,
            tz_offset_minutes: self.tz_offset_minutes,
        };
        Ok((event, stops))
    }
}

/// Body of a new event.
#[derive(Deserialize)]
pub struct EventForm {
    tribe_id: String,
    #[serde(flatten)]
    fields: EventFields,
}

/// `POST /api/events`.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(form): Json<EventForm>,
) -> ApiResult<Json<Event>> {
    require_member(&state, &form.tribe_id, &user.id).await?;
    let (new_event, new_stops) = form.fields.validated()?;
    let tribe_id = form.tribe_id;
    let event = state
        .db
        .call(move |connection| {
            let event = events::create(connection, &tribe_id, &user.id, &new_event)?;
            stops::replace(connection, &event.id, &new_stops.unwrap_or_default())?;
            let summary = format!("{} planned {}", user.name, event.title);
            activity_log::record(
                connection,
                &user.id,
                "planned_event",
                "event",
                &event.id,
                &summary,
            )?;
            Ok(event)
        })
        .await?;
    Ok(Json(event))
}

/// `PATCH /api/events/{event_id}`: for the planner, the tribe's organizers and admins.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(fields): Json<EventFields>,
) -> ApiResult<Json<Event>> {
    managed_event(&state, &event_id, &user).await?;
    let (change, new_stops) = fields.validated()?;
    let moved_or_retimed_id = event_id.clone();
    let event = state
        .db
        .call(move |connection| {
            let event = events::update(connection, &event_id, &user.id, &change)?;
            if let Some(new_stops) = new_stops {
                stops::replace(connection, &event_id, &new_stops)?;
            }
            Ok(event)
        })
        .await?;
    state.conditions.forget(&moved_or_retimed_id);
    Ok(Json(event))
}

/// An item on the list with what earlier groups bought alongside it.
#[derive(Serialize)]
pub struct ItemView {
    #[serde(flatten)]
    item: PrepItem,
    often_with: Vec<Pairing>,
}

/// Everything the event page shows.
#[derive(Serialize)]
pub struct EventDetail {
    event: Event,
    stops: Vec<Stop>,
    attendees: Vec<Attendee>,
    items: Vec<ItemView>,
    conditions: Conditions,
    photos: Vec<Photo>,
    my_origin: Option<LatLng>,
    is_member: bool,
    can_manage: bool,
    model_ready: bool,
}

/// `GET /api/events/{event_id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<EventDetail>> {
    let viewer = user.clone();
    let (event, event_stops, attendees, items, baskets, photos, origin, is_member, is_organizer) =
        state
            .db
            .call(move |connection| {
                let event = events::get(connection, &event_id, &viewer.id)?;
                let members = tribes::members(connection, &event.tribe_id)?;
                let is_member = members.iter().any(|member| member.user_id == viewer.id);
                let is_organizer = members
                    .iter()
                    .any(|member| member.user_id == viewer.id && member.role == "organizer");
                Ok((
                    event,
                    stops::for_event(connection, &event_id)?,
                    events::attendees(connection, &event_id)?,
                    prep::list(connection, &event_id)?,
                    prep::baskets(connection)?,
                    images::photos(connection, &event_id)?,
                    events::origin(connection, &event_id, &viewer.id)?,
                    is_member,
                    is_organizer,
                ))
            })
            .await?;
    let conditions = trip::conditions(&state, &event).await;
    let mut item_views = Vec::with_capacity(items.len());
    for item in items {
        let mut often_with = bought_with(&baskets, &item.name, EvidenceThreshold::default());
        often_with.truncate(3);
        item_views.push(ItemView { item, often_with });
    }
    let can_manage =
        is_organizer || user.is_admin || event.creator_id.as_deref() == Some(user.id.as_str());
    Ok(Json(EventDetail {
        stops: event_stops,
        attendees,
        items: item_views,
        conditions,
        photos,
        my_origin: origin.map(|(lat, lng)| LatLng { lat, lng }),
        is_member,
        can_manage,
        model_ready: state.brain.is_some(),
        event,
    }))
}

/// `DELETE /api/events/{event_id}`: for the planner, the tribe's organizers and admins.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    managed_event(&state, &event_id, &user).await?;
    state
        .db
        .call(move |connection| events::delete(connection, &event_id))
        .await?;
    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

/// Body of an RSVP.
#[derive(Deserialize)]
pub struct RsvpForm {
    going: bool,
}

/// `POST /api/events/{event_id}/rsvp`.
pub async fn rsvp(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(form): Json<RsvpForm>,
) -> ApiResult<Json<Event>> {
    let event = state
        .db
        .call(move |connection| {
            let before = events::get(connection, &event_id, &user.id)?;
            tribes::join(connection, &before.tribe_id, &user.id)?;
            events::rsvp(connection, &event_id, &user.id, form.going)?;
            if form.going && before.my_rsvp.as_deref() != Some("going") {
                let summary = format!("{} is going to {}", user.name, before.title);
                activity_log::record(connection, &user.id, "going", "event", &event_id, &summary)?;
            }
            if !form.going {
                events::clear_origin(connection, &event_id, &user.id)?;
            }
            events::get(connection, &event_id, &user.id)
        })
        .await?;
    Ok(Json(event))
}

/// Body of a vote.
#[derive(Deserialize)]
pub struct VoteForm {
    vote: i64,
}

/// `POST /api/events/{event_id}/vote`: 1, -1, or 0 to remove.
pub async fn vote(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(form): Json<VoteForm>,
) -> ApiResult<Json<Event>> {
    if !(-1..=1).contains(&form.vote) {
        return Err(ApiError::Invalid("vote must be 1, -1 or 0"));
    }
    let event = state
        .db
        .call(move |connection| {
            events::get(connection, &event_id, &user.id)?;
            events::vote(connection, &event_id, &user.id, form.vote)?;
            events::get(connection, &event_id, &user.id)
        })
        .await?;
    Ok(Json(event))
}

/// Body of a starting point.
#[derive(Deserialize)]
pub struct OriginForm {
    lat: f64,
    lng: f64,
}

/// `PUT /api/events/{event_id}/origin`: where the viewer sets off from; deleted a day after the event.
pub async fn set_origin(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(form): Json<OriginForm>,
) -> ApiResult<Json<LatLng>> {
    let point =
        LatLng::new(form.lat, form.lng).ok_or(ApiError::Invalid("that point is not on the map"))?;
    state
        .db
        .call(move |connection| {
            events::get(connection, &event_id, &user.id)?;
            events::set_origin(connection, &event_id, &user.id, point.lat, point.lng)
        })
        .await?;
    Ok(Json(point))
}

/// `DELETE /api/events/{event_id}/origin`.
pub async fn clear_origin(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    state
        .db
        .call(move |connection| events::clear_origin(connection, &event_id, &user.id))
        .await?;
    Ok(Json(serde_json::json!({ "status": "cleared" })))
}
