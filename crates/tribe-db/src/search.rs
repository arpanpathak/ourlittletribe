//! Text search across tribes, upcoming events and people.

use rusqlite::{Connection, ToSql, params};
use serde::Serialize;

use crate::events::{self, Event};
use crate::ids::{EventId, TribeId, UserId};
use crate::tribes::{self, Tribe};
use crate::users::{self, User};
use crate::{DbResult, collect_rows};

/// What a search found.
#[derive(Debug, Clone, Serialize)]
pub struct SearchResults {
    /// Tribes whose name, description or home area matches.
    pub tribes: Vec<Tribe>,
    /// Events that have not started, whose title, description or place matches.
    pub events: Vec<Event>,
    /// People whose name or home area matches, without their emails.
    pub people: Vec<User>,
}

/// Most results of each kind.
const MOST_RESULTS: u32 = 20;

/// The text as a `LIKE` pattern that matches it anywhere, with `%`, `_` and `\` taken literally.
fn like_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// The ids a query returns, in its order.
fn ids<Id: rusqlite::types::FromSql>(
    connection: &Connection,
    sql: &str,
    parameters: &[&dyn ToSql],
) -> DbResult<Vec<Id>> {
    let mut statement = connection.prepare(sql)?;
    collect_rows(statement.query_map(parameters, |row| row.get(0))?)
}

fn matching_tribes(
    connection: &Connection,
    viewer_id: &UserId,
    pattern: &str,
) -> DbResult<Vec<Tribe>> {
    let tribe_ids: Vec<TribeId> = ids(
        connection,
        "SELECT id FROM tribes
         WHERE name LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR home_area LIKE ?1 ESCAPE '\\'
         LIMIT ?2",
        params![pattern, MOST_RESULTS],
    )?;
    tribe_ids
        .iter()
        .map(|tribe_id| tribes::get(connection, tribe_id, viewer_id))
        .collect()
}

fn matching_events(
    connection: &Connection,
    viewer_id: &UserId,
    pattern: &str,
    now: i64,
) -> DbResult<Vec<Event>> {
    let event_ids: Vec<EventId> = ids(
        connection,
        "SELECT id FROM events
         WHERE (title LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR place_name LIKE ?1 ESCAPE '\\')
           AND starts_at >= ?2
         ORDER BY starts_at LIMIT ?3",
        params![pattern, now, MOST_RESULTS],
    )?;
    event_ids
        .iter()
        .map(|event_id| events::get(connection, event_id, viewer_id))
        .collect()
}

fn matching_people(connection: &Connection, pattern: &str) -> DbResult<Vec<User>> {
    let user_ids: Vec<UserId> = ids(
        connection,
        "SELECT id FROM users WHERE name LIKE ?1 ESCAPE '\\' OR home_area LIKE ?1 ESCAPE '\\' LIMIT ?2",
        params![pattern, MOST_RESULTS],
    )?;
    user_ids
        .iter()
        .map(|user_id| users::get(connection, user_id).map(User::public))
        .collect()
}

/// Tribes, upcoming events and people whose words contain `text`.
pub fn search(
    connection: &Connection,
    viewer_id: &UserId,
    text: &str,
    now: i64,
) -> DbResult<SearchResults> {
    let pattern = like_pattern(text.trim());

    Ok(SearchResults {
        tribes: matching_tribes(connection, viewer_id, &pattern)?,
        events: matching_events(connection, viewer_id, &pattern, now)?,
        people: matching_people(connection, &pattern)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;
    use crate::tribes::TribeText;

    #[test]
    fn finds_a_tribe_by_description_and_hides_emails() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada Hiker", "hash")?;
        let text = TribeText {
            name: "Cascade Walkers".to_string(),
            description: "Weekend hikes near Snoqualmie".to_string(),
            ..TribeText::default()
        };
        tribes::create(&mut connection, &ada.id, &text)?;

        assert_eq!(
            search(&connection, &ada.id, "snoqualmie", 0)?.tribes.len(),
            1
        );

        let people = search(&connection, &ada.id, "hiker", 0)?.people;
        let Some(person) = people.first() else {
            panic!("person not found");
        };
        assert!(person.email.is_empty());
        Ok(())
    }

    #[test]
    fn a_percent_sign_is_matched_literally() -> DbResult<()> {
        let connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;

        assert!(search(&connection, &ada.id, "%", 0)?.people.is_empty());
        Ok(())
    }
}
