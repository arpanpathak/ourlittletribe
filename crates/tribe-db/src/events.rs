//! Events, RSVPs, votes and each attendee's trip starting point.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::{DbError, DbResult, new_id, unix_now};

/// What a person fills in to plan an event.
#[derive(Debug, Clone)]
pub struct NewEvent {
    /// Title.
    pub title: String,
    /// Free text; the model reads it when planning what to bring.
    pub description: String,
    /// Where to meet, as written.
    pub place_name: String,
    /// Latitude of the meeting point.
    pub lat: f64,
    /// Longitude of the meeting point.
    pub lng: f64,
    /// Start time, Unix seconds.
    pub starts_at: i64,
    /// The meeting place's offset from UTC, minutes, as the organiser's browser reported it.
    pub tz_offset_minutes: i64,
}

/// An event as seen by one viewer.
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    /// Event id.
    pub id: String,
    /// The tribe running it.
    pub tribe_id: String,
    /// That tribe's name.
    pub tribe_name: String,
    /// That tribe's illustration.
    pub tribe_emblem: String,
    /// Who planned it.
    pub creator_id: Option<String>,
    /// Title.
    pub title: String,
    /// Description.
    pub description: String,
    /// Where to meet.
    pub place_name: String,
    /// Meeting point latitude.
    pub lat: f64,
    /// Meeting point longitude.
    pub lng: f64,
    /// Start time, Unix seconds.
    pub starts_at: i64,
    /// The meeting place's offset from UTC, minutes.
    pub tz_offset_minutes: i64,
    /// When it was planned.
    pub created_at: i64,
    /// How many people said they are going.
    pub going_count: i64,
    /// Up-votes minus down-votes.
    pub net_votes: i64,
    /// The viewer's RSVP: `going`, `not_going`, or none.
    pub my_rsvp: Option<String>,
    /// The viewer's vote: 1, -1 or 0.
    pub my_vote: i64,
    /// The cover picture's id, if one was uploaded.
    pub cover_image: Option<String>,
}

/// Someone who said they are going.
#[derive(Debug, Clone, Serialize)]
pub struct Attendee {
    /// Account id.
    pub user_id: String,
    /// Display name.
    pub name: String,
    /// Their profile picture's id.
    pub avatar: Option<String>,
}

const EVENT_SELECT: &str = "SELECT e.id, e.tribe_id, t.name, t.emblem, e.creator_id, e.title, e.description,
        e.place_name, e.lat, e.lng, e.starts_at, e.created_at, e.tz_offset_minutes,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going'),
        COALESCE((SELECT SUM(v.vote) FROM event_votes v WHERE v.event_id = e.id), 0),
        (SELECT r.status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?1),
        COALESCE((SELECT v.vote FROM event_votes v WHERE v.event_id = e.id AND v.user_id = ?1), 0),
        (SELECT i.id FROM images i WHERE i.event_id = e.id AND i.purpose = 'event_cover' ORDER BY i.created_at DESC LIMIT 1)
     FROM events e JOIN tribes t ON t.id = e.tribe_id";

fn read_event(row: &Row<'_>) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        tribe_id: row.get(1)?,
        tribe_name: row.get(2)?,
        tribe_emblem: row.get(3)?,
        creator_id: row.get(4)?,
        title: row.get(5)?,
        description: row.get(6)?,
        place_name: row.get(7)?,
        lat: row.get(8)?,
        lng: row.get(9)?,
        starts_at: row.get(10)?,
        created_at: row.get(11)?,
        tz_offset_minutes: row.get(12)?,
        going_count: row.get(13)?,
        net_votes: row.get(14)?,
        my_rsvp: row.get(15)?,
        my_vote: row.get(16)?,
        cover_image: row.get(17)?,
    })
}

/// Plans an event; its creator is marked as going and up-votes it.
pub fn create(
    connection: &mut Connection,
    tribe_id: &str,
    creator_id: &str,
    new_event: &NewEvent,
) -> DbResult<Event> {
    let id = new_id();
    let now = unix_now();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO events (id, tribe_id, creator_id, title, description, place_name, lat, lng, starts_at, tz_offset_minutes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            tribe_id,
            creator_id,
            new_event.title,
            new_event.description,
            new_event.place_name,
            new_event.lat,
            new_event.lng,
            new_event.starts_at,
            new_event.tz_offset_minutes,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO event_rsvps (event_id, user_id, status, updated_at) VALUES (?1, ?2, 'going', ?3)",
        params![id, creator_id, now],
    )?;
    transaction.execute(
        "INSERT INTO event_votes (event_id, user_id, vote) VALUES (?1, ?2, 1)",
        params![id, creator_id],
    )?;
    transaction.commit()?;
    get(connection, &id, creator_id)
}

/// Changes what an event says: title, description, place and time.
pub fn update(
    connection: &Connection,
    event_id: &str,
    viewer_id: &str,
    change: &NewEvent,
) -> DbResult<Event> {
    let changed = connection.execute(
        "UPDATE events SET title = ?2, description = ?3, place_name = ?4, lat = ?5, lng = ?6,
                starts_at = ?7, tz_offset_minutes = ?8
         WHERE id = ?1",
        params![
            event_id,
            change.title,
            change.description,
            change.place_name,
            change.lat,
            change.lng,
            change.starts_at,
            change.tz_offset_minutes
        ],
    )?;
    match changed {
        0 => Err(DbError::NotFound),
        _ => get(connection, event_id, viewer_id),
    }
}

/// One event, as seen by the viewer.
pub fn get(connection: &Connection, event_id: &str, viewer_id: &str) -> DbResult<Event> {
    let sql = format!("{EVENT_SELECT} WHERE e.id = ?2");
    connection
        .query_row(&sql, params![viewer_id, event_id], read_event)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Events starting after `from`, soonest first; only one tribe's when `tribe_id` is given.
pub fn upcoming(
    connection: &Connection,
    viewer_id: &str,
    tribe_id: Option<&str>,
    from: i64,
    limit: u32,
) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.starts_at >= ?2 AND (?3 IS NULL OR e.tribe_id = ?3)
         ORDER BY e.starts_at LIMIT ?4"
    );
    let mut statement = connection.prepare(&sql)?;
    let events = statement
        .query_map(params![viewer_id, from, tribe_id, limit], read_event)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

/// A tribe's events that started before `before`, latest first.
pub fn past(
    connection: &Connection,
    viewer_id: &str,
    tribe_id: &str,
    before: i64,
    limit: u32,
) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.tribe_id = ?2 AND e.starts_at < ?3 ORDER BY e.starts_at DESC LIMIT ?4"
    );
    let mut statement = connection.prepare(&sql)?;
    let events = statement
        .query_map(params![viewer_id, tribe_id, before, limit], read_event)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

/// Events the user said they are going to, newest start first.
pub fn attending(connection: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.id IN (SELECT event_id FROM event_rsvps WHERE user_id = ?1 AND status = 'going')
         ORDER BY e.starts_at DESC LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql)?;
    let events = statement
        .query_map(params![user_id, limit], read_event)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(events)
}

/// Deletes an event.
pub fn delete(connection: &Connection, event_id: &str) -> DbResult<()> {
    connection.execute("DELETE FROM events WHERE id = ?1", [event_id])?;
    Ok(())
}

/// Sets the viewer's RSVP to `going` or `not_going`.
pub fn rsvp(connection: &Connection, event_id: &str, user_id: &str, going: bool) -> DbResult<()> {
    let status = match going {
        true => "going",
        false => "not_going",
    };
    connection.execute(
        "INSERT INTO event_rsvps (event_id, user_id, status, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
        params![event_id, user_id, status, unix_now()],
    )?;
    Ok(())
}

/// Records an up-vote (1), a down-vote (-1), or removes the vote (0).
pub fn vote(connection: &Connection, event_id: &str, user_id: &str, vote: i64) -> DbResult<()> {
    match vote {
        1 | -1 => {
            connection.execute(
                "INSERT INTO event_votes (event_id, user_id, vote) VALUES (?1, ?2, ?3)
                 ON CONFLICT (event_id, user_id) DO UPDATE SET vote = excluded.vote",
                params![event_id, user_id, vote],
            )?;
        }
        _ => {
            connection.execute(
                "DELETE FROM event_votes WHERE event_id = ?1 AND user_id = ?2",
                params![event_id, user_id],
            )?;
        }
    }
    Ok(())
}

/// Everyone going, in the order they said so.
pub fn attendees(connection: &Connection, event_id: &str) -> DbResult<Vec<Attendee>> {
    let mut statement = connection.prepare(
        "SELECT u.id, u.name, u.avatar_image FROM event_rsvps r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ?1 AND r.status = 'going' ORDER BY r.updated_at",
    )?;
    let attendees = statement
        .query_map([event_id], |row| {
            Ok(Attendee {
                user_id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(attendees)
}

/// Saves where the user will set off from. Removed automatically after the event.
pub fn set_origin(
    connection: &Connection,
    event_id: &str,
    user_id: &str,
    lat: f64,
    lng: f64,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO trip_origins (event_id, user_id, lat, lng) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (event_id, user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng",
        params![event_id, user_id, lat, lng],
    )?;
    Ok(())
}

/// Where the user said they will set off from, if they did.
pub fn origin(
    connection: &Connection,
    event_id: &str,
    user_id: &str,
) -> DbResult<Option<(f64, f64)>> {
    let origin = connection
        .query_row(
            "SELECT lat, lng FROM trip_origins WHERE event_id = ?1 AND user_id = ?2",
            params![event_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(origin)
}

/// Forgets where the user will set off from.
pub fn clear_origin(connection: &Connection, event_id: &str, user_id: &str) -> DbResult<()> {
    connection.execute(
        "DELETE FROM trip_origins WHERE event_id = ?1 AND user_id = ?2",
        params![event_id, user_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schema, tribes, users};

    fn sample_event(starts_at: i64) -> NewEvent {
        NewEvent {
            title: "Skyline Trail".to_string(),
            description: "Loop from Paradise".to_string(),
            place_name: "Paradise, Mount Rainier".to_string(),
            lat: 46.7865,
            lng: -121.7353,
            starts_at,
            tz_offset_minutes: -480,
        }
    }

    #[test]
    fn creator_is_going_and_counts_update() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Cascade Walkers", "", "", "peak")?;
        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &sample_event(unix_now() + 3600),
        )?;
        assert_eq!(event.going_count, 1);
        assert_eq!(event.my_rsvp.as_deref(), Some("going"));
        assert_eq!(event.net_votes, 1);

        rsvp(&connection, &event.id, &bo.id, true)?;
        vote(&connection, &event.id, &bo.id, -1)?;
        let seen_by_bo = get(&connection, &event.id, &bo.id)?;
        assert_eq!(seen_by_bo.going_count, 2);
        assert_eq!(seen_by_bo.net_votes, 0);
        assert_eq!(seen_by_bo.my_vote, -1);

        rsvp(&connection, &event.id, &bo.id, false)?;
        let names: Vec<String> = attendees(&connection, &event.id)?
            .into_iter()
            .map(|attendee| attendee.name)
            .collect();
        assert_eq!(names, vec!["Ada".to_string()]);
        Ok(())
    }

    #[test]
    fn upcoming_skips_past_events_and_filters_by_tribe() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let walkers = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let readers = tribes::create(&mut connection, &ada.id, "Readers", "", "", "book")?;
        let now = unix_now();
        create(
            &mut connection,
            &walkers.id,
            &ada.id,
            &sample_event(now - 3600),
        )?;
        create(
            &mut connection,
            &walkers.id,
            &ada.id,
            &sample_event(now + 3600),
        )?;
        create(
            &mut connection,
            &readers.id,
            &ada.id,
            &sample_event(now + 7200),
        )?;
        assert_eq!(upcoming(&connection, &ada.id, None, now, 50)?.len(), 2);
        assert_eq!(
            upcoming(&connection, &ada.id, Some(&walkers.id), now, 50)?.len(),
            1
        );
        assert_eq!(past(&connection, &ada.id, &walkers.id, now, 50)?.len(), 1);
        Ok(())
    }

    #[test]
    fn update_changes_the_plan() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &sample_event(unix_now() + 60),
        )?;
        let mut change = sample_event(unix_now() + 7200);
        change.title = "Skyline Trail, sunrise".to_string();
        let updated = update(&connection, &event.id, &ada.id, &change)?;
        assert_eq!(updated.title, "Skyline Trail, sunrise");
        assert_eq!(updated.going_count, 1);
        assert!(matches!(
            update(&connection, "missing", &ada.id, &change),
            Err(DbError::NotFound)
        ));
        Ok(())
    }

    #[test]
    fn origin_can_be_set_and_cleared() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &sample_event(unix_now() + 60),
        )?;
        set_origin(&connection, &event.id, &ada.id, 47.6, -122.3)?;
        assert_eq!(
            origin(&connection, &event.id, &ada.id)?,
            Some((47.6, -122.3))
        );
        clear_origin(&connection, &event.id, &ada.id)?;
        assert_eq!(origin(&connection, &event.id, &ada.id)?, None);
        Ok(())
    }
}
