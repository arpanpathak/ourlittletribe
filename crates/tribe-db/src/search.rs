//! Text search across tribes, upcoming events and people, through the search
//! index: any word of the search matches, in any form ("replacing" finds
//! "replace"), and near spellings match too.

use rusqlite::Connection;
use serde::Serialize;

use crate::DbResult;
use crate::events::{self, Event};
use crate::ids::{EventId, TribeId, UserId};
use crate::search_index::{self, Kind};
use crate::tribes::{self, Tribe};
use crate::users::{self, User};

/// What a search found.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SearchResults {
    /// Matching tribes, best first.
    pub tribes: Vec<Tribe>,
    /// Matching events that have not started, best first.
    pub events: Vec<Event>,
    /// Matching people, without their emails.
    pub people: Vec<User>,
}

impl SearchResults {
    /// Whether nothing was found.
    pub fn is_empty(&self) -> bool {
        self.tribes.is_empty() && self.events.is_empty() && self.people.is_empty()
    }
}

/// Most results of each kind.
const MOST_RESULTS: usize = 20;

fn matching_tribes(
    connection: &Connection,
    viewer_id: &UserId,
    text: &str,
) -> DbResult<Vec<Tribe>> {
    let ids: Vec<TribeId> = search_index::find(connection, Kind::Tribe, text)?;
    let best = ids.iter().take(MOST_RESULTS);

    best.map(|id| tribes::get(connection, id, viewer_id))
        .collect()
}

fn matching_events(
    connection: &Connection,
    viewer_id: &UserId,
    text: &str,
    now: i64,
) -> DbResult<Vec<Event>> {
    let ids: Vec<EventId> = search_index::find(connection, Kind::Event, text)?;

    let mut upcoming = Vec::new();
    for id in &ids {
        let event = events::get(connection, id, viewer_id)?;
        if event.starts_at >= now {
            upcoming.push(event);
        }

        if upcoming.len() == MOST_RESULTS {
            break;
        }
    }
    Ok(upcoming)
}

fn matching_people(connection: &Connection, text: &str) -> DbResult<Vec<User>> {
    let ids: Vec<UserId> = search_index::find(connection, Kind::Person, text)?;
    let best = ids.iter().take(MOST_RESULTS);

    best.map(|id| users::get(connection, id).map(User::public))
        .collect()
}

/// Tribes, upcoming events and people matching any word of `text`.
pub fn search(
    connection: &Connection,
    viewer_id: &UserId,
    text: &str,
    now: i64,
) -> DbResult<SearchResults> {
    let tribes = matching_tribes(connection, viewer_id, text)?;
    let events = matching_events(connection, viewer_id, text, now)?;
    let people = matching_people(connection, text)?;

    Ok(SearchResults {
        tribes,
        events,
        people,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;
    use crate::tribes::TribeText;

    fn tribe_named(
        connection: &mut Connection,
        owner: &UserId,
        name: &str,
        description: &str,
    ) -> DbResult<()> {
        let text = TribeText {
            name: name.to_string(),
            description: description.to_string(),
            ..TribeText::default()
        };
        tribes::create(connection, owner, &text)?;
        Ok(())
    }

    #[test]
    fn finds_a_tribe_by_description_and_hides_emails() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada Hiker", "hash")?;
        tribe_named(
            &mut connection,
            &ada.id,
            "Cascade Walkers",
            "Weekend hikes near Snoqualmie",
        )?;

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
    fn other_forms_of_a_word_match() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        tribe_named(&mut connection, &ada.id, "ai-won't-replace-us", "")?;

        let found = search(&connection, &ada.id, "ai replacing", 0)?.tribes;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "ai-won't-replace-us");
        Ok(())
    }

    #[test]
    fn a_typo_still_matches() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        tribe_named(&mut connection, &ada.id, "Snoqualmie Ramblers", "")?;

        assert_eq!(
            search(&connection, &ada.id, "snoqualme", 0)?.tribes.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn a_single_letter_does_not_match_everything() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        tribe_named(&mut connection, &ada.id, "ai-won't-replace-us", "")?;
        tribe_named(&mut connection, &ada.id, "Trail Runners", "")?;

        let found = search(&connection, &ada.id, "won't", 0)?.tribes;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "ai-won't-replace-us");
        Ok(())
    }

    #[test]
    fn punctuation_alone_finds_nothing() -> DbResult<()> {
        let connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;

        assert!(search(&connection, &ada.id, "%", 0)?.is_empty());
        Ok(())
    }

    #[test]
    fn a_renamed_tribe_is_found_by_its_new_name() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        tribe_named(&mut connection, &ada.id, "Old Name", "")?;
        connection.execute("UPDATE tribes SET name = 'Fremont Family Hikes'", [])?;

        assert_eq!(search(&connection, &ada.id, "family", 0)?.tribes.len(), 1);
        assert!(search(&connection, &ada.id, "old", 0)?.tribes.is_empty());
        Ok(())
    }
}
