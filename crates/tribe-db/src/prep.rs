//! The packing list of an event: what to bring, and who has it.
//!
//! *Personal* items are things each person needs, such as water or a
//! headlamp; every attendee marks their own copy as got. *Shared* items are
//! one for the group, such as a first-aid kit; someone marks it as bringing,
//! then got. Everyone going sees every mark.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;
use tribe_core::basket::Basket;
use tribe_core::osm::ShopTags;

use crate::ids::{EventId, ImageId, ItemId, UserId};
use crate::kinds::{ItemSource, MarkState, Scope};
use crate::{DbError, DbResult, collect_rows, unix_now};

/// Who put an item on the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum AddedBy {
    /// The planning model suggested it.
    Model,
    /// A person added it; their id is gone once their account is deleted.
    Person {
        /// Their account.
        user_id: Option<UserId>,
    },
}

impl AddedBy {
    fn source(&self) -> ItemSource {
        match self {
            AddedBy::Model => ItemSource::Model,
            AddedBy::Person { .. } => ItemSource::Person,
        }
    }

    fn user_id(&self) -> Option<&UserId> {
        match self {
            AddedBy::Model => None,
            AddedBy::Person { user_id } => user_id.as_ref(),
        }
    }

    fn from_columns(source: ItemSource, user_id: Option<UserId>) -> AddedBy {
        match source {
            ItemSource::Model => AddedBy::Model,
            ItemSource::Person => AddedBy::Person { user_id },
        }
    }
}

/// An item to put on a list.
#[derive(Debug, Clone)]
pub struct NewItem {
    /// What to bring.
    pub name: String,
    /// Why it is on the list, naming the fact it answers to.
    pub why: String,
    /// One each, or one for the group.
    pub scope: Scope,
    /// How many for the whole group.
    pub quantity: i64,
    /// The kinds of shop that sell it.
    pub shop_tags: ShopTags,
}

/// One person's mark on an item.
#[derive(Debug, Clone, Serialize)]
pub struct ItemMark {
    /// Their account.
    pub user_id: UserId,
    /// Display name.
    pub name: String,
    /// Their profile picture.
    pub avatar: Option<ImageId>,
    /// Whether they are bringing it or have it.
    pub state: MarkState,
}

/// An item on an event's list, with everyone's marks.
#[derive(Debug, Clone, Serialize)]
pub struct PrepItem {
    /// Item id.
    pub id: ItemId,
    /// What to bring.
    pub name: String,
    /// Why it is on the list.
    pub why: String,
    /// One each, or one for the group.
    pub scope: Scope,
    /// How many for the whole group.
    pub quantity: i64,
    /// The kinds of shop that sell it.
    pub shop_tags: ShopTags,
    /// Who put it on the list; written as `source` (and `user_id`) in JSON.
    #[serde(flatten)]
    pub added_by: AddedBy,
    /// Everyone's marks, oldest first.
    pub marks: Vec<ItemMark>,
}

fn join_tags(tags: &[String]) -> String {
    tags.join(",")
}

fn split_tags(joined: &str) -> ShopTags {
    joined
        .split(',')
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

/// Adds items to an event's list, skipping names already on it (ignoring case).
/// Returns how many were added.
pub fn add_items(
    connection: &mut Connection,
    event_id: &EventId,
    added_by: &AddedBy,
    items: &[NewItem],
) -> DbResult<usize> {
    let now = unix_now();
    let transaction = connection.transaction()?;

    let mut added = 0;
    for item in items {
        added += transaction.execute(
            "INSERT OR IGNORE INTO prep_items
               (id, event_id, name, why, scope, quantity, shop_tags, source, added_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                ItemId::random(),
                event_id,
                item.name,
                item.why,
                item.scope,
                item.quantity,
                join_tags(&item.shop_tags),
                added_by.source(),
                added_by.user_id(),
                now
            ],
        )?;
    }

    transaction.commit()?;
    Ok(added)
}

/// Every mark on an event's items, grouped by item.
fn marks_by_item(
    connection: &Connection,
    event_id: &EventId,
) -> DbResult<BTreeMap<ItemId, Vec<ItemMark>>> {
    let mut statement = connection.prepare(
        "SELECT m.item_id, m.user_id, u.name, m.state, u.avatar_image
         FROM item_marks m
         JOIN prep_items p ON p.id = m.item_id
         JOIN users u ON u.id = m.user_id
         WHERE p.event_id = ?1
         ORDER BY m.updated_at",
    )?;
    let read_mark = |row: &Row<'_>| {
        let mark = ItemMark {
            user_id: row.get(1)?,
            name: row.get(2)?,
            state: row.get(3)?,
            avatar: row.get(4)?,
        };
        Ok((row.get::<_, ItemId>(0)?, mark))
    };

    let mut grouped: BTreeMap<ItemId, Vec<ItemMark>> = BTreeMap::new();
    for (item_id, mark) in collect_rows(statement.query_map([event_id], read_mark)?)? {
        grouped.entry(item_id).or_default().push(mark);
    }
    Ok(grouped)
}

fn read_item(row: &Row<'_>) -> rusqlite::Result<PrepItem> {
    let shop_tags: String = row.get(5)?;
    let added_by = AddedBy::from_columns(row.get(6)?, row.get(7)?);

    Ok(PrepItem {
        id: row.get(0)?,
        name: row.get(1)?,
        why: row.get(2)?,
        scope: row.get(3)?,
        quantity: row.get(4)?,
        shop_tags: split_tags(&shop_tags),
        added_by,
        marks: Vec::new(),
    })
}

/// The event's list, shared items first, each with its marks.
pub fn list(connection: &Connection, event_id: &EventId) -> DbResult<Vec<PrepItem>> {
    let mut marks = marks_by_item(connection, event_id)?;

    let mut statement = connection.prepare(
        "SELECT id, name, why, scope, quantity, shop_tags, source, added_by
         FROM prep_items WHERE event_id = ?1
         ORDER BY scope = 'shared' DESC, created_at, name",
    )?;
    let mut items = collect_rows(statement.query_map([event_id], read_item)?)?;

    for item in &mut items {
        item.marks = marks.remove(&item.id).unwrap_or_default();
    }
    Ok(items)
}

/// Where an item belongs: its event, and who added it.
#[derive(Debug, Clone)]
pub struct ItemOwner {
    /// The event whose list it is on.
    pub event_id: EventId,
    /// Who put it there.
    pub added_by: AddedBy,
}

/// The event an item belongs to, and who added it.
pub fn owner_of(connection: &Connection, item_id: &ItemId) -> DbResult<ItemOwner> {
    let read_owner = |row: &Row<'_>| {
        Ok(ItemOwner {
            event_id: row.get(0)?,
            added_by: AddedBy::from_columns(row.get(1)?, row.get(2)?),
        })
    };

    connection
        .query_row(
            "SELECT event_id, source, added_by FROM prep_items WHERE id = ?1",
            [item_id],
            read_owner,
        )
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Sets a person's mark on an item, or removes it with `None`.
pub fn set_mark(
    connection: &Connection,
    item_id: &ItemId,
    user_id: &UserId,
    state: Option<MarkState>,
) -> DbResult<()> {
    let Some(state) = state else {
        connection.execute(
            "DELETE FROM item_marks WHERE item_id = ?1 AND user_id = ?2",
            params![item_id, user_id],
        )?;
        return Ok(());
    };

    connection.execute(
        "INSERT INTO item_marks (item_id, user_id, state, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (item_id, user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
        params![item_id, user_id, state, unix_now()],
    )?;
    Ok(())
}

/// Replaces the kinds of shop that sell an item.
pub fn set_shop_tags(
    connection: &Connection,
    item_id: &ItemId,
    shop_tags: &[String],
) -> DbResult<()> {
    connection.execute(
        "UPDATE prep_items SET shop_tags = ?2 WHERE id = ?1",
        params![item_id, join_tags(shop_tags)],
    )?;
    Ok(())
}

/// Removes an item from its list.
pub fn delete_item(connection: &Connection, item_id: &ItemId) -> DbResult<()> {
    connection.execute("DELETE FROM prep_items WHERE id = ?1", [item_id])?;
    Ok(())
}

/// One basket per event: the names of the items someone marked as got.
/// This is the only purchase signal the app learns pairings from.
pub fn baskets(connection: &Connection) -> DbResult<Vec<Basket>> {
    let mut statement = connection.prepare(
        "SELECT p.event_id, p.name FROM prep_items p
         WHERE EXISTS (SELECT 1 FROM item_marks m WHERE m.item_id = p.id AND m.state = 'got')
         ORDER BY p.event_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, EventId>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut by_event: BTreeMap<EventId, Basket> = BTreeMap::new();
    for (event_id, name) in collect_rows(rows)? {
        by_event.entry(event_id).or_default().push(name);
    }
    Ok(by_event.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::tests::{ada_and_her_tribe, skyline_trail};
    use crate::{events, users};

    fn item(name: &str, scope: Scope) -> NewItem {
        NewItem {
            name: name.to_string(),
            why: "test".to_string(),
            scope,
            quantity: 1,
            shop_tags: vec!["supermarket".to_string(), "convenience".to_string()],
        }
    }

    fn find<'a>(items: &'a [PrepItem], name: &str) -> &'a PrepItem {
        let Some(found) = items.iter().find(|item| item.name == name) else {
            panic!("{name} missing");
        };
        found
    }

    #[test]
    fn repeated_names_are_skipped_and_shared_items_come_first() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;

        let model_items = [
            item("Water", Scope::Personal),
            item("First-aid kit", Scope::Shared),
        ];
        assert_eq!(
            add_items(&mut connection, &event.id, &AddedBy::Model, &model_items)?,
            2
        );

        let by_bo = AddedBy::Person {
            user_id: Some(bo.id.clone()),
        };
        assert_eq!(
            add_items(
                &mut connection,
                &event.id,
                &by_bo,
                &[item("water", Scope::Personal)]
            )?,
            0
        );

        let items = list(&connection, &event.id)?;
        let names: Vec<&str> = items.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["First-aid kit", "Water"]);
        assert_eq!(find(&items, "Water").added_by, AddedBy::Model);
        Ok(())
    }

    #[test]
    fn marks_are_visible_and_got_items_make_a_basket() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;
        add_items(
            &mut connection,
            &event.id,
            &AddedBy::Model,
            &[item("Water", Scope::Personal)],
        )?;
        let water_id = find(&list(&connection, &event.id)?, "Water").id.clone();

        set_mark(&connection, &water_id, &ada.id, Some(MarkState::Got))?;
        set_mark(&connection, &water_id, &bo.id, Some(MarkState::Got))?;
        set_mark(&connection, &water_id, &bo.id, None)?;

        let items = list(&connection, &event.id)?;
        let who: Vec<&str> = find(&items, "Water")
            .marks
            .iter()
            .map(|mark| mark.name.as_str())
            .collect();
        assert_eq!(who, vec!["Ada"]);
        assert_eq!(baskets(&connection)?, vec![vec!["Water".to_string()]]);
        Ok(())
    }
}
