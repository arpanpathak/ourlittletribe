//! Who may do what. Every rule is here, so each route asks one question.
//!
//! | Action | Allowed for |
//! |---|---|
//! | add to an event, share photos, plan items | members of its tribe |
//! | change or delete an event, its cover | its planner, the tribe's organizers, admins |
//! | change a tribe, its cover | its organizers, admins |

use tribe_db::events::{self, Event};
use tribe_db::ids::{EventId, TribeId};
use tribe_db::kinds::Role;
use tribe_db::tribes;
use tribe_db::users::User;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// The person's role in a tribe; admins count as organizers everywhere.
async fn role_in(state: &AppState, tribe_id: &TribeId, user: &User) -> ApiResult<Option<Role>> {
    if user.is_admin {
        return Ok(Some(Role::Organizer));
    }

    let tribe_id = tribe_id.clone();
    let user_id = user.id.clone();
    let role = state
        .db
        .call(move |connection| tribes::role_of(connection, &tribe_id, &user_id))
        .await?;
    Ok(role)
}

/// Fails with `403` unless the person belongs to the tribe.
pub async fn require_member(state: &AppState, tribe_id: &TribeId, user: &User) -> ApiResult<()> {
    match role_in(state, tribe_id, user).await? {
        Some(_) => Ok(()),
        None => Err(ApiError::Forbidden("join the tribe first")),
    }
}

/// Fails with `403` unless the person organizes the tribe.
pub async fn require_organizer(state: &AppState, tribe_id: &TribeId, user: &User) -> ApiResult<()> {
    match role_in(state, tribe_id, user).await? {
        Some(Role::Organizer) => Ok(()),
        Some(Role::Member) | None => Err(ApiError::Forbidden(
            "only the tribe's organizers can change this",
        )),
    }
}

/// Whether the person may change the event: they planned it, or they organize its tribe.
pub async fn can_manage(state: &AppState, event: &Event, user: &User) -> ApiResult<bool> {
    let planned_it = event.creator_id.as_ref() == Some(&user.id);
    let role = role_in(state, &event.tribe_id, user).await?;
    Ok(planned_it || role == Some(Role::Organizer))
}

/// The event as the person sees it.
pub async fn event_for(state: &AppState, event_id: &EventId, user: &User) -> ApiResult<Event> {
    let event_id = event_id.clone();
    let viewer_id = user.id.clone();
    let event = state
        .db
        .call(move |connection| events::get(connection, &event_id, &viewer_id))
        .await?;
    Ok(event)
}

/// The event, if the person may change it; `403` otherwise.
pub async fn managed_event(state: &AppState, event_id: &EventId, user: &User) -> ApiResult<Event> {
    let event = event_for(state, event_id, user).await?;
    match can_manage(state, &event, user).await? {
        true => Ok(event),
        false => Err(ApiError::Forbidden(
            "only the planner or an organizer can change this",
        )),
    }
}

/// The event, if the person belongs to its tribe; `403` otherwise.
pub async fn member_event(state: &AppState, event_id: &EventId, user: &User) -> ApiResult<Event> {
    let event = event_for(state, event_id, user).await?;
    require_member(state, &event.tribe_id, user).await?;
    Ok(event)
}
