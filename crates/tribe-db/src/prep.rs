//! The prep list of an event: what to bring, and who has it.
//!
//! *Personal* items are things each person needs (water, a headlamp); every
//! attendee marks their own copy as `got`. *Shared* items are one for the
//! group (a first-aid kit); someone marks `bringing`, then `got`. Everyone
//! going sees every mark.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::{DbError, DbResult, new_id, unix_now};

/// An item to put on a list.
#[derive(Debug, Clone)]
pub struct NewItem {
    /// What to bring.
    pub name: String,
    /// Why it is on the list.
    pub why: String,
    /// `personal` or `shared`.
    pub scope: String,
    /// How many for the whole group.
    pub quantity: i64,
    /// OpenStreetMap `shop` values of stores that sell it.
    pub shop_tags: Vec<String>,
}

/// One person's mark on an item.
#[derive(Debug, Clone, Serialize)]
pub struct ItemMark {
    /// Account id.
    pub user_id: String,
    /// Display name.
    pub name: String,
    /// Their profile picture's id.
    pub avatar: Option<String>,
    /// `bringing` or `got`.
    pub state: String,
}

/// An item on an event's list, with everyone's marks.
#[derive(Debug, Clone, Serialize)]
pub struct PrepItem {
    /// Item id.
    pub id: String,
    /// What to bring.
    pub name: String,
    /// Why it is on the list.
    pub why: String,
    /// `personal` or `shared`.
    pub scope: String,
    /// How many for the whole group.
    pub quantity: i64,
    /// OpenStreetMap `shop` values of stores that sell it.
    pub shop_tags: Vec<String>,
    /// `model` when suggested by the model, `person` when someone added it.
    pub source: String,
    /// Who added it, for items added by a person.
    pub added_by: Option<String>,
    /// Marks from attendees.
    pub marks: Vec<ItemMark>,
}

fn join_tags(tags: &[String]) -> String {
    tags.join(",")
}

fn split_tags(joined: &str) -> Vec<String> {
    joined
        .split(',')
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

/// Adds items to an event's list, skipping names already on it. Returns how many were added.
pub fn add_items(
    connection: &mut Connection,
    event_id: &str,
    source: &str,
    added_by: Option<&str>,
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
                new_id(),
                event_id,
                item.name,
                item.why,
                item.scope,
                item.quantity,
                join_tags(&item.shop_tags),
                source,
                added_by,
                now
            ],
        )?;
    }
    transaction.commit()?;
    Ok(added)
}

/// The event's list, shared items first, each with its marks.
pub fn list(connection: &Connection, event_id: &str) -> DbResult<Vec<PrepItem>> {
    let mut marks_by_item: BTreeMap<String, Vec<ItemMark>> = BTreeMap::new();
    let mut mark_statement = connection.prepare(
        "SELECT m.item_id, m.user_id, u.name, m.state, u.avatar_image
         FROM item_marks m
         JOIN prep_items p ON p.id = m.item_id
         JOIN users u ON u.id = m.user_id
         WHERE p.event_id = ?1
         ORDER BY m.updated_at",
    )?;
    let mut mark_rows = mark_statement.query([event_id])?;
    while let Some(row) = mark_rows.next()? {
        let item_id: String = row.get(0)?;
        let mark = ItemMark {
            user_id: row.get(1)?,
            name: row.get(2)?,
            avatar: row.get(4)?,
            state: row.get(3)?,
        };
        marks_by_item.entry(item_id).or_default().push(mark);
    }

    let mut item_statement = connection.prepare(
        "SELECT id, name, why, scope, quantity, shop_tags, source, added_by
         FROM prep_items WHERE event_id = ?1
         ORDER BY scope = 'shared' DESC, created_at, name",
    )?;
    let mut item_rows = item_statement.query([event_id])?;
    let mut items = Vec::new();
    while let Some(row) = item_rows.next()? {
        let id: String = row.get(0)?;
        let shop_tags: String = row.get(5)?;
        let marks = marks_by_item.remove(&id).unwrap_or_default();
        items.push(PrepItem {
            id,
            name: row.get(1)?,
            why: row.get(2)?,
            scope: row.get(3)?,
            quantity: row.get(4)?,
            shop_tags: split_tags(&shop_tags),
            source: row.get(6)?,
            added_by: row.get(7)?,
            marks,
        });
    }
    Ok(items)
}

/// The event an item belongs to.
pub fn event_of(connection: &Connection, item_id: &str) -> DbResult<String> {
    connection
        .query_row(
            "SELECT event_id FROM prep_items WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Sets the user's mark on an item to `bringing` or `got`, or removes it with `None`.
pub fn set_mark(
    connection: &Connection,
    item_id: &str,
    user_id: &str,
    state: Option<&str>,
) -> DbResult<()> {
    match state {
        Some(state) => {
            connection.execute(
                "INSERT INTO item_marks (item_id, user_id, state, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (item_id, user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
                params![item_id, user_id, state, unix_now()],
            )?;
        }
        None => {
            connection.execute(
                "DELETE FROM item_marks WHERE item_id = ?1 AND user_id = ?2",
                params![item_id, user_id],
            )?;
        }
    }
    Ok(())
}

/// Replaces the shop tags of an item, once the model has said where it is sold.
pub fn set_shop_tags(connection: &Connection, item_id: &str, shop_tags: &[String]) -> DbResult<()> {
    connection.execute(
        "UPDATE prep_items SET shop_tags = ?2 WHERE id = ?1",
        params![item_id, join_tags(shop_tags)],
    )?;
    Ok(())
}

/// Who added an item, if a person did.
pub fn added_by(connection: &Connection, item_id: &str) -> DbResult<Option<String>> {
    connection
        .query_row(
            "SELECT added_by FROM prep_items WHERE id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Removes an item from its list.
pub fn delete_item(connection: &Connection, item_id: &str) -> DbResult<()> {
    connection.execute("DELETE FROM prep_items WHERE id = ?1", [item_id])?;
    Ok(())
}

/// One basket per event: the names of items someone marked `got`.
///
/// This is the only purchase signal the app learns pairings from.
pub fn baskets(connection: &Connection) -> DbResult<Vec<Vec<String>>> {
    let mut statement = connection.prepare(
        "SELECT p.event_id, p.name FROM prep_items p
         WHERE EXISTS (SELECT 1 FROM item_marks m WHERE m.item_id = p.id AND m.state = 'got')
         ORDER BY p.event_id",
    )?;
    let mut rows = statement.query([])?;
    let mut by_event: BTreeMap<String, Vec<String>> = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let event_id: String = row.get(0)?;
        let name: String = row.get(1)?;
        by_event.entry(event_id).or_default().push(name);
    }
    Ok(by_event.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{self, NewEvent};
    use crate::{schema, tribes, users};

    fn item(name: &str, scope: &str) -> NewItem {
        NewItem {
            name: name.to_string(),
            why: "test".to_string(),
            scope: scope.to_string(),
            quantity: 1,
            shop_tags: vec!["supermarket".to_string(), "convenience".to_string()],
        }
    }

    #[test]
    fn marks_are_visible_and_duplicates_skipped() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &NewEvent {
                title: "Hike".to_string(),
                description: String::new(),
                place_name: "Trailhead".to_string(),
                lat: 47.0,
                lng: -121.0,
                starts_at: unix_now() + 60,
                tz_offset_minutes: 0,
            },
        )?;

        let added = add_items(
            &mut connection,
            &event.id,
            "model",
            None,
            &[item("Water", "personal"), item("First-aid kit", "shared")],
        )?;
        assert_eq!(added, 2);
        let added_again = add_items(
            &mut connection,
            &event.id,
            "person",
            Some(&bo.id),
            &[item("water", "personal")],
        )?;
        assert_eq!(added_again, 0);

        let items = list(&connection, &event.id)?;
        let names: Vec<&str> = items.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["First-aid kit", "Water"]);

        let Some(water) = items.iter().find(|item| item.name == "Water") else {
            panic!("water missing");
        };
        assert_eq!(
            water.shop_tags,
            vec!["supermarket".to_string(), "convenience".to_string()]
        );
        set_mark(&connection, &water.id, &ada.id, Some("got"))?;
        set_mark(&connection, &water.id, &bo.id, Some("got"))?;
        set_mark(&connection, &water.id, &bo.id, None)?;

        let items = list(&connection, &event.id)?;
        let Some(water) = items.iter().find(|item| item.name == "Water") else {
            panic!("water missing");
        };
        let who: Vec<&str> = water.marks.iter().map(|mark| mark.name.as_str()).collect();
        assert_eq!(who, vec!["Ada"]);
        assert_eq!(baskets(&connection)?, vec![vec!["Water".to_string()]]);
        Ok(())
    }
}
