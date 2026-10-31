//! The prep list: the model's plan, items people add, marks, search, and stores on the way.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use tribe_brain::{Brain, PlannedItem, clean_items};
use tribe_core::geo::LatLng;
use tribe_core::recommend::NeededItem;
use tribe_db::events::{self, Event};
use tribe_db::prep::{self, NewItem, PrepItem};
use tribe_db::{activity_log, unix_now};

use super::{bounded, require_member};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use crate::trip::{self, TripView};

fn brain(state: &AppState) -> ApiResult<Arc<Brain>> {
    state.brain.clone().ok_or(ApiError::NoModel)
}

fn as_new_items(planned: Vec<PlannedItem>) -> Vec<NewItem> {
    let mut items = Vec::with_capacity(planned.len());
    for item in planned {
        items.push(NewItem {
            name: item.name,
            why: item.why,
            scope: item.scope,
            quantity: item.quantity,
            shop_tags: item.shop_tags,
        });
    }
    items
}

async fn event_and_origin(
    state: &AppState,
    event_id: String,
    user_id: String,
) -> ApiResult<(Event, Option<LatLng>)> {
    let found = state
        .db
        .call(move |connection| {
            let event = events::get(connection, &event_id, &user_id)?;
            let origin = events::origin(connection, &event_id, &user_id)?;
            Ok((event, origin.map(|(lat, lng)| LatLng { lat, lng })))
        })
        .await?;
    Ok(found)
}

async fn drive_for(
    state: &AppState,
    event: &Event,
    origin: Option<LatLng>,
) -> Option<tribe_places::osrm::Route> {
    let start = origin?;
    let destination = LatLng {
        lat: event.lat,
        lng: event.lng,
    };
    match state.places.route(start, destination).await {
        Ok(route) => Some(route),
        Err(error) => {
            tracing::warn!(%error, "routing failed while planning");
            None
        }
    }
}

/// What the plan step added.
#[derive(Serialize)]
pub struct PlanResult {
    added: usize,
    items: Vec<PrepItem>,
}

/// `POST /api/events/{event_id}/plan`: asks the model what the group should bring and adds it.
pub async fn plan(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<PlanResult>> {
    let brain = brain(&state)?;
    let (event, origin) = event_and_origin(&state, event_id.clone(), user.id.clone()).await?;
    require_member(&state, &event.tribe_id, &user.id).await?;
    let drive = drive_for(&state, &event, origin).await;
    let facts = trip::trip_facts(&state, &event, drive.as_ref()).await?;
    let planned = brain.plan_items(&facts).await?;
    let new_items = as_new_items(planned);
    let result = state
        .db
        .call(move |connection| {
            let added = prep::add_items(connection, &event_id, "model", None, &new_items)?;
            if added > 0 {
                let summary = format!(
                    "{} asked for a prep list for {} ({added} items)",
                    user.name, event.title
                );
                activity_log::record(
                    connection,
                    &user.id,
                    "planned_items",
                    "event",
                    &event_id,
                    &summary,
                )?;
            }
            Ok(PlanResult {
                added,
                items: prep::list(connection, &event_id)?,
            })
        })
        .await?;
    Ok(Json(result))
}

/// Body of an item someone adds by hand, or picks from a search.
#[derive(Deserialize)]
pub struct ItemForm {
    name: String,
    #[serde(default)]
    why: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    quantity: Option<i64>,
    #[serde(default)]
    shop_tags: Vec<String>,
}

/// `POST /api/events/{event_id}/items`.
///
/// When the item comes without shop tags and a model is set up, the model is
/// asked in the background where it is sold, so the map can find it.
pub async fn add(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(form): Json<ItemForm>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    let (event, origin) = event_and_origin(&state, event_id.clone(), user.id.clone()).await?;
    require_member(&state, &event.tribe_id, &user.id).await?;
    let name = bounded(&form.name, 80, "item name is too long")?;
    if name.is_empty() {
        return Err(ApiError::Invalid("name the item"));
    }
    let checked = clean_items(
        vec![PlannedItem {
            name,
            why: form.why,
            scope: form.scope,
            quantity: form.quantity.unwrap_or(event.going_count.max(1)),
            shop_tags: form.shop_tags,
        }],
        &[],
    );
    let new_items = as_new_items(checked);
    let needs_tags = new_items.iter().any(|item| item.shop_tags.is_empty());
    let item_name = new_items
        .first()
        .map(|item| item.name.clone())
        .unwrap_or_default();
    let added_by = user.id.clone();
    let list_event_id = event_id.clone();
    let items = state
        .db
        .call(move |connection| {
            let added = prep::add_items(
                connection,
                &list_event_id,
                "person",
                Some(&added_by),
                &new_items,
            )?;
            if added == 0 {
                return Err(tribe_db::DbError::AlreadyExists);
            }
            prep::list(connection, &list_event_id)
        })
        .await
        .map_err(|error| match error {
            tribe_db::DbError::AlreadyExists => {
                ApiError::Conflict("that item is already on the list")
            }
            other => ApiError::from(other),
        })?;

    if let (true, Some(brain)) = (needs_tags, state.brain.clone()) {
        let background_state = state.clone();
        let item_id = items
            .iter()
            .find(|item| item.name.eq_ignore_ascii_case(&item_name))
            .map(|item| item.id.clone());
        tokio::spawn(async move {
            let Some(item_id) = item_id else {
                return;
            };
            let drive = drive_for(&background_state, &event, origin).await;
            let facts = match trip::trip_facts(&background_state, &event, drive.as_ref()).await {
                Ok(facts) => facts,
                Err(error) => {
                    tracing::warn!(%error, "could not gather facts for tagging");
                    return;
                }
            };
            let tags = match brain.items_for_search(&item_name, &facts).await {
                Ok(found) => found
                    .into_iter()
                    .next()
                    .map(|item| item.shop_tags)
                    .unwrap_or_default(),
                Err(error) => {
                    tracing::warn!(%error, "tagging an item failed");
                    return;
                }
            };
            if tags.is_empty() {
                return;
            }
            let saved = background_state
                .db
                .call(move |connection| prep::set_shop_tags(connection, &item_id, &tags))
                .await;
            if let Err(error) = saved {
                tracing::warn!(%error, "saving item tags failed");
            }
        });
    }
    Ok(Json(items))
}

/// Body of a mark.
#[derive(Deserialize)]
pub struct MarkForm {
    state: Option<String>,
}

/// `POST /api/items/{item_id}/mark`: `got`, `bringing`, or `null` to clear.
pub async fn mark(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item_id): Path<String>,
    Json(form): Json<MarkForm>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    let mark_state = match form.state.as_deref() {
        Some("got") => Some("got"),
        Some("bringing") => Some("bringing"),
        None => None,
        Some(_) => return Err(ApiError::Invalid("mark must be got, bringing or null")),
    };
    let lookup_id = item_id.clone();
    let viewer_id = user.id.clone();
    let event = state
        .db
        .call(move |connection| {
            let event_id = prep::event_of(connection, &lookup_id)?;
            events::get(connection, &event_id, &viewer_id)
        })
        .await?;
    require_member(&state, &event.tribe_id, &user.id).await?;
    let items = state
        .db
        .call(move |connection| {
            prep::set_mark(connection, &item_id, &user.id, mark_state)?;
            prep::list(connection, &event.id)
        })
        .await?;
    Ok(Json(items))
}

/// `DELETE /api/items/{item_id}`: for whoever added it, the event's planner and admins.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item_id): Path<String>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    let removed = state
        .db
        .call(move |connection| {
            let event_id = prep::event_of(connection, &item_id)?;
            let event = events::get(connection, &event_id, &user.id)?;
            let added_by = prep::added_by(connection, &item_id)?;
            let allowed = user.is_admin
                || added_by.as_deref() == Some(user.id.as_str())
                || event.creator_id.as_deref() == Some(user.id.as_str());
            match allowed {
                true => {
                    prep::delete_item(connection, &item_id)?;
                    Ok(Some(prep::list(connection, &event_id)?))
                }
                false => Ok(None),
            }
        })
        .await?;
    removed.map(Json).ok_or(ApiError::Forbidden(
        "only whoever added it or the planner can remove this",
    ))
}

/// `GET /api/events/{event_id}/trip`: the viewer's route and the best stops for what they still need.
pub async fn trip(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
) -> ApiResult<Json<TripView>> {
    let (event, origin) = event_and_origin(&state, event_id.clone(), user.id.clone()).await?;
    let items = state
        .db
        .call(move |connection| prep::list(connection, &event_id))
        .await?;
    let needed = trip::still_needed(&items, &user.id);
    let view = trip::plan_stops(&state, &event, origin, &needed).await?;
    Ok(Json(view))
}

/// Body of a search.
#[derive(Deserialize)]
pub struct FindForm {
    query: String,
}

/// What a search found: the items the model suggests and where to get them.
#[derive(Serialize)]
pub struct FindResult {
    items: Vec<PlannedItem>,
    trip: TripView,
}

/// `POST /api/events/{event_id}/find`: turns a search like "my feet get cold" into
/// items, then finds stores on the viewer's way that sell them.
pub async fn find(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<String>,
    Json(form): Json<FindForm>,
) -> ApiResult<Json<FindResult>> {
    let query = bounded(&form.query, 200, "search is too long")?;
    if query.is_empty() {
        return Err(ApiError::Invalid("type what you are looking for"));
    }
    let brain = brain(&state)?;
    let (event, origin) = event_and_origin(&state, event_id, user.id.clone()).await?;
    let drive = drive_for(&state, &event, origin).await;
    let facts = trip::trip_facts(&state, &event, drive.as_ref()).await?;
    let items = brain.items_for_search(&query, &facts).await?;
    let mut needed = Vec::with_capacity(items.len());
    for item in &items {
        needed.push(NeededItem {
            name: item.name.clone(),
            shop_tags: item.shop_tags.clone(),
        });
    }
    let trip = trip::plan_stops(&state, &event, origin, &needed).await?;
    tracing::info!(
        at = unix_now(),
        found = items.len(),
        stores = trip.stores.len(),
        "search answered"
    );
    Ok(Json(FindResult { items, trip }))
}
