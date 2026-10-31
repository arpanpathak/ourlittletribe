//! A person's trip to an event: their route and the stores on it, and the
//! model's briefing on the conditions.

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;
use tribe_brain::briefing::{Briefing, Units};
use tribe_core::geo::LatLng;
use tribe_db::events::{self, Event};
use tribe_db::ids::EventId;
use tribe_db::prep;
use tribe_db::users::User;
use tribe_places::osrm::Route;

use super::access::event_for;
use super::model;
use crate::auth::CurrentUser;
use crate::error::ApiResult;
use crate::facts;
use crate::state::{AppState, BriefingKey};
use crate::stores_on_route::{self, TripView};

/// Where the viewer said they start from, if they did.
pub(super) async fn origin_of(
    state: &AppState,
    event: &Event,
    user: &User,
) -> ApiResult<Option<LatLng>> {
    let event_id = event.id.clone();
    let user_id = user.id.clone();
    let origin = state
        .db
        .call(move |connection| events::origin(connection, &event_id, &user_id))
        .await?;
    Ok(origin)
}

/// The drive from `origin` to the meeting point, when there is an origin and routing works.
pub(super) async fn drive_for(
    state: &AppState,
    event: &Event,
    origin: Option<LatLng>,
) -> Option<Route> {
    let start = origin?;
    match state.places.route(start, event.meeting_point.point).await {
        Ok(route) => Some(route),
        Err(error) => {
            tracing::warn!(%error, "routing failed");
            None
        }
    }
}

/// `GET /api/events/{event_id}/trip`: your route and the best stops for what you still need.
pub async fn trip(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<Json<TripView>> {
    let event = event_for(&state, &event_id, &user).await?;
    let origin = origin_of(&state, &event, &user).await?;
    let items = state
        .db
        .call(move |connection| prep::list(connection, &event_id))
        .await?;

    let needed = stores_on_route::still_needed(&items, &user.id);
    let view = stores_on_route::plan(&state, &event, origin, &needed).await?;
    Ok(Json(view))
}

/// Query of `GET /api/events/{event_id}/briefing`.
#[derive(Deserialize)]
pub struct BriefingQuery {
    /// `imperial` or `metric`; metric when left out.
    units: Option<Units>,
}

/// `GET /api/events/{event_id}/briefing?units=imperial`: what the model makes of
/// the conditions for this plan. Cached for an hour, and dropped when the event changes.
pub async fn briefing(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Query(query): Query<BriefingQuery>,
) -> ApiResult<Json<Briefing>> {
    let brain = model(&state)?;
    let units = query.units.unwrap_or(Units::Metric);

    let key = BriefingKey {
        event_id: event_id.clone(),
        units,
    };
    if let Some(cached) = state.caches.briefings.get(&key) {
        return Ok(Json(cached));
    }

    let event = event_for(&state, &event_id, &user).await?;
    let trip_facts = facts::for_event(&state, &event, None).await?;
    let written = brain.write_briefing(&trip_facts, units).await?;

    state.caches.briefings.put(key, written.clone());
    Ok(Json(written))
}
