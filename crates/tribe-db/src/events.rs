//! Events, RSVPs, votes and each attendee's starting point.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Row, ToSql, params};
use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;
use tribe_core::itinerary::Place;

use crate::ids::{EventId, ImageId, TribeId, UserId};
use crate::kinds::Rsvp;
use crate::{DbError, DbResult, collect_rows, unix_now};

/// What a person fills in to plan an event, or to change one.
#[derive(Debug, Clone)]
pub struct EventPlan {
    /// Title.
    pub title: String,
    /// What the plan is, in Markdown; the model reads it when planning the list.
    pub description: String,
    /// Where everyone gathers first.
    pub meeting_point: Place,
    /// Start time, Unix seconds.
    pub starts_at: i64,
    /// The meeting place's offset from UTC in minutes, as the planner's browser reported it.
    pub tz_offset_minutes: i64,
}

/// An event as one viewer sees it.
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    /// Event id.
    pub id: EventId,
    /// The tribe it belongs to.
    pub tribe_id: TribeId,
    /// That tribe's name.
    pub tribe_name: String,
    /// Who planned it; empty once their account is deleted.
    pub creator_id: Option<UserId>,
    /// Title.
    pub title: String,
    /// What the plan is, in Markdown.
    pub description: String,
    /// Where everyone gathers first.
    pub meeting_point: Place,
    /// Start time, Unix seconds.
    pub starts_at: i64,
    /// The meeting place's offset from UTC, minutes.
    pub tz_offset_minutes: i64,
    /// When it was planned, Unix seconds.
    pub created_at: i64,
    /// How many people said they are going.
    pub going_count: i64,
    /// Up-votes minus down-votes.
    pub net_votes: i64,
    /// The viewer's answer, if they gave one.
    pub my_rsvp: Option<Rsvp>,
    /// The viewer's vote, if they voted.
    pub my_vote: Option<Vote>,
    /// The cover picture, if one was uploaded.
    pub cover_image: Option<ImageId>,
}

/// Someone who said they are going.
#[derive(Debug, Clone, Serialize)]
pub struct Attendee {
    /// Their account.
    pub user_id: UserId,
    /// Display name.
    pub name: String,
    /// Their profile picture.
    pub avatar: Option<ImageId>,
}

/// A thumbs up or down on an event; stored as 1 or -1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Vote {
    /// Thumbs up.
    Up,
    /// Thumbs down.
    Down,
}

impl ToSql for Vote {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let stored: i64 = match self {
            Vote::Up => 1,
            Vote::Down => -1,
        };
        Ok(ToSqlOutput::from(stored))
    }
}

impl FromSql for Vote {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Vote> {
        match value.as_i64()? {
            1 => Ok(Vote::Up),
            -1 => Ok(Vote::Down),
            other => Err(FromSqlError::OutOfRange(other)),
        }
    }
}

const EVENT_SELECT: &str = "SELECT e.id, e.tribe_id, t.name, e.creator_id, e.title, e.description,
        e.place_name, e.lat, e.lng, e.starts_at, e.created_at, e.tz_offset_minutes,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going'),
        COALESCE((SELECT SUM(v.vote) FROM event_votes v WHERE v.event_id = e.id), 0),
        (SELECT r.status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?1),
        (SELECT v.vote FROM event_votes v WHERE v.event_id = e.id AND v.user_id = ?1),
        (SELECT i.id FROM images i WHERE i.event_id = e.id AND i.purpose = 'event_cover' ORDER BY i.created_at DESC LIMIT 1)
     FROM events e JOIN tribes t ON t.id = e.tribe_id";

fn read_event(row: &Row<'_>) -> rusqlite::Result<Event> {
    let meeting_point = Place {
        name: row.get(6)?,
        point: LatLng {
            lat: row.get(7)?,
            lng: row.get(8)?,
        },
    };

    Ok(Event {
        id: row.get(0)?,
        tribe_id: row.get(1)?,
        tribe_name: row.get(2)?,
        creator_id: row.get(3)?,
        title: row.get(4)?,
        description: row.get(5)?,
        meeting_point,
        starts_at: row.get(9)?,
        created_at: row.get(10)?,
        tz_offset_minutes: row.get(11)?,
        going_count: row.get(12)?,
        net_votes: row.get(13)?,
        my_rsvp: row.get(14)?,
        my_vote: row.get(15)?,
        cover_image: row.get(16)?,
    })
}

fn read_attendee(row: &Row<'_>) -> rusqlite::Result<Attendee> {
    Ok(Attendee {
        user_id: row.get(0)?,
        name: row.get(1)?,
        avatar: row.get(2)?,
    })
}

/// Plans an event. Its planner is marked as going and gives it a thumbs up.
pub fn create(
    connection: &mut Connection,
    tribe_id: &TribeId,
    planner_id: &UserId,
    plan: &EventPlan,
) -> DbResult<Event> {
    let event_id = EventId::random();
    let now = unix_now();
    let place = &plan.meeting_point;

    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO events (id, tribe_id, creator_id, title, description, place_name, lat, lng, starts_at, tz_offset_minutes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            event_id,
            tribe_id,
            planner_id,
            plan.title,
            plan.description,
            place.name,
            place.point.lat,
            place.point.lng,
            plan.starts_at,
            plan.tz_offset_minutes,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO event_rsvps (event_id, user_id, status, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![event_id, planner_id, Rsvp::Going, now],
    )?;
    transaction.execute(
        "INSERT INTO event_votes (event_id, user_id, vote) VALUES (?1, ?2, ?3)",
        params![event_id, planner_id, Vote::Up],
    )?;
    transaction.commit()?;

    get(connection, &event_id, planner_id)
}

/// Changes what an event says: title, description, meeting point and time.
pub fn update(
    connection: &Connection,
    event_id: &EventId,
    viewer_id: &UserId,
    plan: &EventPlan,
) -> DbResult<Event> {
    let place = &plan.meeting_point;

    let changed = connection.execute(
        "UPDATE events SET title = ?2, description = ?3, place_name = ?4, lat = ?5, lng = ?6,
                starts_at = ?7, tz_offset_minutes = ?8
         WHERE id = ?1",
        params![
            event_id,
            plan.title,
            plan.description,
            place.name,
            place.point.lat,
            place.point.lng,
            plan.starts_at,
            plan.tz_offset_minutes
        ],
    )?;

    match changed {
        0 => Err(DbError::NotFound),
        _ => get(connection, event_id, viewer_id),
    }
}

/// One event, as the viewer sees it.
pub fn get(connection: &Connection, event_id: &EventId, viewer_id: &UserId) -> DbResult<Event> {
    let sql = format!("{EVENT_SELECT} WHERE e.id = ?2");
    connection
        .query_row(&sql, params![viewer_id, event_id], read_event)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Events starting at or after `from`, soonest first; only one tribe's when `tribe_id` is given.
pub fn upcoming(
    connection: &Connection,
    viewer_id: &UserId,
    tribe_id: Option<&TribeId>,
    from: i64,
    limit: u32,
) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.starts_at >= ?2 AND (?3 IS NULL OR e.tribe_id = ?3) ORDER BY e.starts_at LIMIT ?4"
    );
    let mut statement = connection.prepare(&sql)?;
    collect_rows(statement.query_map(params![viewer_id, from, tribe_id, limit], read_event)?)
}

/// A tribe's events that started before `before`, latest first.
pub fn past(
    connection: &Connection,
    viewer_id: &UserId,
    tribe_id: &TribeId,
    before: i64,
    limit: u32,
) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.tribe_id = ?2 AND e.starts_at < ?3 ORDER BY e.starts_at DESC LIMIT ?4"
    );
    let mut statement = connection.prepare(&sql)?;
    collect_rows(statement.query_map(params![viewer_id, tribe_id, before, limit], read_event)?)
}

/// Events a person said they are going to, latest start first.
pub fn attending(connection: &Connection, user_id: &UserId, limit: u32) -> DbResult<Vec<Event>> {
    let sql = format!(
        "{EVENT_SELECT} WHERE e.id IN (SELECT event_id FROM event_rsvps WHERE user_id = ?1 AND status = 'going')
         ORDER BY e.starts_at DESC LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql)?;
    collect_rows(statement.query_map(params![user_id, limit], read_event)?)
}

/// Deletes an event and, through the foreign keys, everything attached to it.
pub fn delete(connection: &Connection, event_id: &EventId) -> DbResult<()> {
    connection.execute("DELETE FROM events WHERE id = ?1", [event_id])?;
    Ok(())
}

/// Sets a person's answer to an event.
pub fn set_rsvp(
    connection: &Connection,
    event_id: &EventId,
    user_id: &UserId,
    answer: Rsvp,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO event_rsvps (event_id, user_id, status, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
        params![event_id, user_id, answer, unix_now()],
    )?;
    Ok(())
}

/// Sets a person's vote on an event, or removes it with `None`.
pub fn set_vote(
    connection: &Connection,
    event_id: &EventId,
    user_id: &UserId,
    vote: Option<Vote>,
) -> DbResult<()> {
    let Some(vote) = vote else {
        connection.execute(
            "DELETE FROM event_votes WHERE event_id = ?1 AND user_id = ?2",
            params![event_id, user_id],
        )?;
        return Ok(());
    };

    connection.execute(
        "INSERT INTO event_votes (event_id, user_id, vote) VALUES (?1, ?2, ?3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET vote = excluded.vote",
        params![event_id, user_id, vote],
    )?;
    Ok(())
}

/// Everyone going, in the order they said so.
pub fn attendees(connection: &Connection, event_id: &EventId) -> DbResult<Vec<Attendee>> {
    let mut statement = connection.prepare(
        "SELECT u.id, u.name, u.avatar_image FROM event_rsvps r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ?1 AND r.status = 'going' ORDER BY r.updated_at",
    )?;
    collect_rows(statement.query_map([event_id], read_attendee)?)
}

/// Saves where a person will set off from. It is deleted a day after the event.
pub fn set_origin(
    connection: &Connection,
    event_id: &EventId,
    user_id: &UserId,
    origin: LatLng,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO trip_origins (event_id, user_id, lat, lng) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (event_id, user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng",
        params![event_id, user_id, origin.lat, origin.lng],
    )?;
    Ok(())
}

/// Where a person said they will set off from, if they did.
pub fn origin(
    connection: &Connection,
    event_id: &EventId,
    user_id: &UserId,
) -> DbResult<Option<LatLng>> {
    let origin = connection
        .query_row(
            "SELECT lat, lng FROM trip_origins WHERE event_id = ?1 AND user_id = ?2",
            params![event_id, user_id],
            |row| {
                Ok(LatLng {
                    lat: row.get(0)?,
                    lng: row.get(1)?,
                })
            },
        )
        .optional()?;
    Ok(origin)
}

/// Forgets where a person will set off from.
pub fn clear_origin(connection: &Connection, event_id: &EventId, user_id: &UserId) -> DbResult<()> {
    connection.execute(
        "DELETE FROM trip_origins WHERE event_id = ?1 AND user_id = ?2",
        params![event_id, user_id],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::schema;
    use crate::tribes::{self, Tribe, TribeText};
    use crate::users::{self, User};

    /// A connection with one person, Ada, and her tribe.
    pub(crate) fn ada_and_her_tribe() -> DbResult<(Connection, User, Tribe)> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;

        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let text = TribeText {
            name: "Walkers".to_string(),
            ..TribeText::default()
        };
        let tribe = tribes::create(&mut connection, &ada.id, &text)?;
        Ok((connection, ada, tribe))
    }

    /// A hike at Paradise starting at `starts_at`.
    pub(crate) fn skyline_trail(starts_at: i64) -> EventPlan {
        EventPlan {
            title: "Skyline Trail".to_string(),
            description: "Loop from Paradise".to_string(),
            meeting_point: Place {
                name: "Paradise, Mount Rainier".to_string(),
                point: LatLng {
                    lat: 46.7865,
                    lng: -121.7353,
                },
            },
            starts_at,
            tz_offset_minutes: -480,
        }
    }

    #[test]
    fn planner_is_going_and_counts_follow_answers() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;

        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 3600),
        )?;
        assert_eq!(event.going_count, 1);
        assert_eq!(event.my_rsvp, Some(Rsvp::Going));
        assert_eq!(event.net_votes, 1);

        set_rsvp(&connection, &event.id, &bo.id, Rsvp::Going)?;
        set_vote(&connection, &event.id, &bo.id, Some(Vote::Down))?;
        let seen_by_bo = get(&connection, &event.id, &bo.id)?;
        assert_eq!(seen_by_bo.going_count, 2);
        assert_eq!(seen_by_bo.net_votes, 0);
        assert_eq!(seen_by_bo.my_vote, Some(Vote::Down));

        set_rsvp(&connection, &event.id, &bo.id, Rsvp::NotGoing)?;
        let names: Vec<String> = attendees(&connection, &event.id)?
            .into_iter()
            .map(|attendee| attendee.name)
            .collect();
        assert_eq!(names, vec!["Ada".to_string()]);
        Ok(())
    }

    #[test]
    fn upcoming_skips_past_events_and_filters_by_tribe() -> DbResult<()> {
        let (mut connection, ada, walkers) = ada_and_her_tribe()?;
        let readers_text = TribeText {
            name: "Readers".to_string(),
            ..TribeText::default()
        };
        let readers = tribes::create(&mut connection, &ada.id, &readers_text)?;
        let now = unix_now();

        create(
            &mut connection,
            &walkers.id,
            &ada.id,
            &skyline_trail(now - 3600),
        )?;
        create(
            &mut connection,
            &walkers.id,
            &ada.id,
            &skyline_trail(now + 3600),
        )?;
        create(
            &mut connection,
            &readers.id,
            &ada.id,
            &skyline_trail(now + 7200),
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
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;

        let mut change = skyline_trail(unix_now() + 7200);
        change.title = "Skyline Trail, sunrise".to_string();
        let updated = update(&connection, &event.id, &ada.id, &change)?;

        assert_eq!(updated.title, "Skyline Trail, sunrise");
        assert_eq!(updated.going_count, 1);
        let missing = EventId::from("missing");
        assert!(matches!(
            update(&connection, &missing, &ada.id, &change),
            Err(DbError::NotFound)
        ));
        Ok(())
    }

    #[test]
    fn origin_can_be_set_and_cleared() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let event = create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;
        let home = LatLng {
            lat: 47.6,
            lng: -122.3,
        };

        set_origin(&connection, &event.id, &ada.id, home)?;
        assert_eq!(origin(&connection, &event.id, &ada.id)?, Some(home));

        clear_origin(&connection, &event.id, &ada.id)?;
        assert_eq!(origin(&connection, &event.id, &ada.id)?, None);
        Ok(())
    }
}
