//! The packing list: items people add, items the model plans, items that
//! answer a search, marks, and removing items.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tribe_brain::items::{self as model_items, PlannedItem};
use tribe_core::osm::{ShopTags, is_plain_tag};
use tribe_core::recommend::NeededItem;
use tribe_db::activity_log::{self, About};
use tribe_db::events::Event;
use tribe_db::ids::{EventId, ItemId};
use tribe_db::kinds::{Action, MarkState, Scope};
use tribe_db::prep::{self, AddedBy, NewItem, PrepItem};
use tribe_db::{DbError, events};

use super::access::member_event;
use super::trip::{drive_for, origin_of};
use super::{bounded, model};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::facts;
use crate::state::AppState;
use crate::stores_on_route::{self, TripView};

/// The database's scope for the model's.
fn stored_scope(scope: model_items::Scope) -> Scope {
    match scope {
        model_items::Scope::Personal => Scope::Personal,
        model_items::Scope::Shared => Scope::Shared,
    }
}

fn as_new_item(planned: PlannedItem) -> NewItem {
    NewItem {
        name: planned.name,
        why: planned.why,
        scope: stored_scope(planned.scope),
        quantity: planned.quantity,
        shop_tags: planned.shop_tags,
    }
}

/// The tags that are plain lower-case OpenStreetMap values, each once.
fn checked_tags(raw: Vec<String>) -> ShopTags {
    let mut tags = ShopTags::new();
    for tag in raw.into_iter().map(|tag| tag.trim().to_lowercase()) {
        if is_plain_tag(&tag) && !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    tags
}

/// Body of `POST /api/events/{event_id}/items`.
#[derive(Deserialize)]
pub struct ItemForm {
    /// What to bring, 1 to 80 characters.
    name: String,
    /// Why, at most 200 characters.
    #[serde(default)]
    why: String,
    /// One each, or one for the group; one each when left out.
    #[serde(default)]
    scope: Option<Scope>,
    /// How many for the group; one per person going when left out.
    #[serde(default)]
    quantity: Option<i64>,
    /// The kinds of shop that sell it; the model fills them in when left out.
    #[serde(default)]
    shop_tags: Vec<String>,
}

impl ItemForm {
    fn checked(self, event: &Event) -> ApiResult<NewItem> {
        let name = bounded(&self.name, 80, "item name is too long")?;
        if name.is_empty() {
            return Err(ApiError::Invalid("name the item"));
        }

        Ok(NewItem {
            name,
            why: bounded(&self.why, 200, "the reason is too long")?,
            scope: self.scope.unwrap_or(Scope::Personal),
            quantity: self
                .quantity
                .unwrap_or(event.going_count.max(1))
                .clamp(1, 500),
            shop_tags: checked_tags(self.shop_tags),
        })
    }
}

/// Asks the model, in the background, which shops sell an item someone added
/// without saying, so the store search can find it.
fn tag_in_background(
    state: AppState,
    event: Event,
    item_name: String,
    item_id: ItemId,
    user: tribe_db::users::User,
) {
    let Some(brain) = state.brain.clone() else {
        return;
    };

    tokio::spawn(async move {
        let origin = origin_of(&state, &event, &user).await.ok().flatten();
        let drive = drive_for(&state, &event, origin).await;
        let trip_facts = match facts::for_event(&state, &event, drive.as_ref()).await {
            Ok(trip_facts) => trip_facts,
            Err(error) => return tracing::warn!(%error, "could not gather facts for tagging"),
        };

        let tags = match brain.items_for_search(&item_name, &trip_facts).await {
            Ok(found) => found
                .into_iter()
                .next()
                .map(|item| item.shop_tags)
                .unwrap_or_default(),
            Err(error) => return tracing::warn!(%error, "tagging an item failed"),
        };
        if tags.is_empty() {
            return;
        }

        let saved = state
            .db
            .call(move |connection| prep::set_shop_tags(connection, &item_id, &tags))
            .await;
        if let Err(error) = saved {
            tracing::warn!(%error, "saving item tags failed");
        }
    });
}

/// `POST /api/events/{event_id}/items`: adds an item by hand. Answers `409`
/// when an item of that name is already on the list.
pub async fn add(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Json(form): Json<ItemForm>,
) -> ApiResult<(StatusCode, Json<Vec<PrepItem>>)> {
    let event = member_event(&state, &event_id, &user).await?;
    let item = form.checked(&event)?;
    let needs_tags = item.shop_tags.is_empty();
    let item_name = item.name.clone();
    let added_by = AddedBy::Person {
        user_id: Some(user.id.clone()),
    };

    let stored = state
        .db
        .call(move |connection| {
            let added = prep::add_items(connection, &event_id, &added_by, &[item])?;
            if added == 0 {
                return Err(DbError::AlreadyExists);
            }
            prep::list(connection, &event_id)
        })
        .await;

    let items = match stored {
        Ok(items) => items,
        Err(DbError::AlreadyExists) => {
            return Err(ApiError::Conflict("that item is already on the list"));
        }
        Err(other) => return Err(other.into()),
    };

    let new_item_id = items
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(&item_name))
        .map(|item| item.id.clone());
    if let (true, Some(item_id)) = (needs_tags, new_item_id) {
        tag_in_background(state.clone(), event, item_name, item_id, user);
    }

    Ok((StatusCode::CREATED, Json(items)))
}

/// What a planning run added.
#[derive(Serialize)]
pub struct PlanResult {
    /// How many items were new.
    added: usize,
    /// The whole list after it.
    items: Vec<PrepItem>,
}

/// `POST /api/events/{event_id}/item-plans`: asks the model what the group
/// should bring, and adds what is not on the list yet.
pub async fn plan(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
) -> ApiResult<(StatusCode, Json<PlanResult>)> {
    let brain = model(&state)?;
    let event = member_event(&state, &event_id, &user).await?;
    let origin = origin_of(&state, &event, &user).await?;
    let drive = drive_for(&state, &event, origin).await;

    let trip_facts = facts::for_event(&state, &event, drive.as_ref()).await?;
    let planned = brain.plan_items(&trip_facts).await?;
    let new_items: Vec<NewItem> = planned.into_iter().map(as_new_item).collect();

    let result = state
        .db
        .call(move |connection| {
            let added = prep::add_items(connection, &event_id, &AddedBy::Model, &new_items)?;
            if added > 0 {
                let summary = format!(
                    "{} asked for a packing list for {} ({added} items)",
                    user.name, event.title
                );
                activity_log::record(
                    connection,
                    &user.id,
                    Action::PlannedItems,
                    &About::Event(event_id.clone()),
                    &summary,
                )?;
            }
            Ok(PlanResult {
                added,
                items: prep::list(connection, &event_id)?,
            })
        })
        .await?;

    Ok((StatusCode::CREATED, Json(result)))
}

/// Query of `GET /api/events/{event_id}/item-suggestions`.
#[derive(Deserialize)]
pub struct SuggestionQuery {
    /// What the person is looking for, such as "something for mosquitoes".
    q: String,
}

/// Items that answer a search, and stores on the way that sell them.
#[derive(Serialize)]
pub struct Suggestions {
    /// The items the model suggests; not added to the list.
    items: Vec<PlannedItem>,
    /// The person's route and stores for these items.
    trip: TripView,
}

/// `GET /api/events/{event_id}/item-suggestions?q=…`: turns a search like
/// "my feet get cold" into items for this trip, and stores on the way.
pub async fn suggestions(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(event_id): Path<EventId>,
    Query(query): Query<SuggestionQuery>,
) -> ApiResult<Json<Suggestions>> {
    let search = bounded(&query.q, 200, "search is too long")?;
    if search.is_empty() {
        return Err(ApiError::Invalid("type what you are looking for"));
    }
    let brain = model(&state)?;
    let event = member_event(&state, &event_id, &user).await?;
    let origin = origin_of(&state, &event, &user).await?;
    let drive = drive_for(&state, &event, origin).await;

    let trip_facts = facts::for_event(&state, &event, drive.as_ref()).await?;
    let items = brain.items_for_search(&search, &trip_facts).await?;

    let needed: Vec<NeededItem> = items
        .iter()
        .map(|item| NeededItem {
            name: item.name.clone(),
            shop_tags: item.shop_tags.clone(),
        })
        .collect();
    let trip = stores_on_route::plan(&state, &event, origin, &needed).await?;
    Ok(Json(Suggestions { items, trip }))
}

/// The event an item is on, if the person belongs to its tribe.
async fn item_event(
    state: &AppState,
    item_id: &ItemId,
    user: &tribe_db::users::User,
) -> ApiResult<Event> {
    let lookup_id = item_id.clone();
    let owner = state
        .db
        .call(move |connection| prep::owner_of(connection, &lookup_id))
        .await?;
    member_event(state, &owner.event_id, user).await
}

/// Body of `PUT /api/items/{item_id}/marks/me`.
#[derive(Deserialize)]
pub struct MarkForm {
    /// `bringing` or `got`.
    state: MarkState,
}

async fn store_mark(
    state: &AppState,
    item_id: ItemId,
    user: tribe_db::users::User,
    mark: Option<MarkState>,
) -> ApiResult<Vec<PrepItem>> {
    let event = item_event(state, &item_id, &user).await?;
    let items = state
        .db
        .call(move |connection| {
            prep::set_mark(connection, &item_id, &user.id, mark)?;
            prep::list(connection, &event.id)
        })
        .await?;
    Ok(items)
}

/// `PUT /api/items/{item_id}/marks/me`: you are bringing it, or have it.
pub async fn set_mark(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item_id): Path<ItemId>,
    Json(form): Json<MarkForm>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    Ok(Json(
        store_mark(&state, item_id, user, Some(form.state)).await?,
    ))
}

/// `DELETE /api/items/{item_id}/marks/me`: takes your mark back.
pub async fn clear_mark(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item_id): Path<ItemId>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    Ok(Json(store_mark(&state, item_id, user, None).await?))
}

/// `DELETE /api/items/{item_id}`: for whoever added it, the event's planner and admins.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(item_id): Path<ItemId>,
) -> ApiResult<Json<Vec<PrepItem>>> {
    let removed = state
        .db
        .call(move |connection| {
            let owner = prep::owner_of(connection, &item_id)?;
            let event = events::get(connection, &owner.event_id, &user.id)?;

            let added_it = matches!(&owner.added_by, AddedBy::Person { user_id: Some(adder) } if *adder == user.id);
            let planned_event = event.creator_id.as_ref() == Some(&user.id);
            if !(user.is_admin || added_it || planned_event) {
                return Ok(None);
            }

            prep::delete_item(connection, &item_id)?;
            Ok(Some(prep::list(connection, &owner.event_id)?))
        })
        .await?;

    removed.map(Json).ok_or(ApiError::Forbidden(
        "only whoever added it or the planner can remove this",
    ))
}
