//! Text search across tribes, upcoming events and people.

use rusqlite::{Connection, ToSql, params};
use serde::Serialize;

use crate::DbResult;
use crate::events::{self, Event};
use crate::tribes::{self, Tribe};
use crate::users::{self, User};

/// What a search found.
#[derive(Debug, Clone, Serialize)]
pub struct SearchResults {
    /// Matching tribes.
    pub tribes: Vec<Tribe>,
    /// Matching events that have not started.
    pub events: Vec<Event>,
    /// Matching people, without their emails.
    pub people: Vec<User>,
}

fn like_pattern(query: &str) -> String {
    let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

fn matching_ids(connection: &Connection, sql: &str, parameters: &[&dyn ToSql]) -> DbResult<Vec<String>> {
    let mut statement = connection.prepare(sql)?;
    let ids = statement
        .query_map(parameters, |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(ids)
}

/// Finds tribes, upcoming events and people whose names or descriptions contain `query`.
pub fn search(connection: &Connection, viewer_id: &str, query: &str, now: i64) -> DbResult<SearchResults> {
    let pattern = like_pattern(query.trim());

    let tribe_ids = matching_ids(
        connection,
        "SELECT id FROM tribes WHERE name LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR home_area LIKE ?1 ESCAPE '\\' LIMIT 20",
        params![pattern],
    )?;
    let mut found_tribes = Vec::new();
    for tribe_id in tribe_ids {
        found_tribes.push(tribes::get(connection, &tribe_id, viewer_id)?);
    }

    let event_ids = matching_ids(
        connection,
        "SELECT id FROM events WHERE (title LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR place_name LIKE ?1 ESCAPE '\\')
           AND starts_at >= ?2 ORDER BY starts_at LIMIT 20",
        params![pattern, now],
    )?;
    let mut found_events = Vec::new();
    for event_id in event_ids {
        found_events.push(events::get(connection, &event_id, viewer_id)?);
    }

    let user_ids = matching_ids(
        connection,
        "SELECT id FROM users WHERE name LIKE ?1 ESCAPE '\\' OR home_area LIKE ?1 ESCAPE '\\' LIMIT 20",
        params![pattern],
    )?;
    let mut found_people = Vec::new();
    for user_id in user_ids {
        found_people.push(users::get(connection, &user_id)?.public());
    }

    Ok(SearchResults {
        tribes: found_tribes,
        events: found_events,
        people: found_people,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schema, tribes as tribe_queries, users as user_queries};

    #[test]
    fn finds_tribe_by_description_and_hides_email() -> DbResult<()> {
        let mut connection = rusqlite::Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = user_queries::create(&connection, "a@example.com", "Ada Hiker", "hash")?;
        tribe_queries::create(&mut connection, &ada.id, "Cascade Walkers", "Weekend hikes near Snoqualmie", "", "peak")?;
        let results = search(&connection, &ada.id, "snoqualmie", 0)?;
        assert_eq!(results.tribes.len(), 1);
        let results = search(&connection, &ada.id, "hiker", 0)?;
        let Some(person) = results.people.first() else {
            panic!("person not found");
        };
        assert!(person.email.is_empty());
        Ok(())
    }

    #[test]
    fn percent_sign_is_matched_literally() -> DbResult<()> {
        let connection = rusqlite::Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = user_queries::create(&connection, "a@example.com", "Ada", "hash")?;
        let results = search(&connection, &ada.id, "%", 0)?;
        assert!(results.people.is_empty());
        Ok(())
    }
}
