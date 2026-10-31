//! The places an event goes besides where people meet: stops on the way,
//! optional stops, and the venue itself. They are kept in the order the
//! planner set; the meeting point is the event's own place.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::{DbResult, new_id};

/// What a stop is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopKind {
    /// A stop everyone makes on the way, such as a coffee or a trailhead parking lot.
    Stop,
    /// A stop some may make, such as a viewpoint or a store.
    Optional,
    /// Where the event itself happens, when it is not the meeting point.
    Venue,
}

impl StopKind {
    fn as_str(self) -> &'static str {
        match self {
            StopKind::Stop => "stop",
            StopKind::Optional => "optional",
            StopKind::Venue => "venue",
        }
    }

    fn parse(text: &str) -> StopKind {
        match text {
            "optional" => StopKind::Optional,
            "venue" => StopKind::Venue,
            _ => StopKind::Stop,
        }
    }
}

/// A stop to save.
#[derive(Debug, Clone, PartialEq)]
pub struct NewStop {
    /// What it is for.
    pub kind: StopKind,
    /// Its name.
    pub name: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
    /// A line from the planner, such as "Grab coffee, 15 minutes".
    pub note: String,
}

/// A saved stop.
#[derive(Debug, Clone, Serialize)]
pub struct Stop {
    /// Stop id.
    pub id: String,
    /// What it is for.
    pub kind: StopKind,
    /// Its name.
    pub name: String,
    /// Latitude.
    pub lat: f64,
    /// Longitude.
    pub lng: f64,
    /// A line from the planner.
    pub note: String,
}

/// Replaces an event's stops with `stops`, in that order.
pub fn replace(connection: &mut Connection, event_id: &str, stops: &[NewStop]) -> DbResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM event_stops WHERE event_id = ?1", [event_id])?;
    for (position, stop) in stops.iter().enumerate() {
        transaction.execute(
            "INSERT INTO event_stops (id, event_id, kind, name, lat, lng, note, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                new_id(),
                event_id,
                stop.kind.as_str(),
                stop.name,
                stop.lat,
                stop.lng,
                stop.note,
                position as i64
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

/// An event's stops, in order.
pub fn for_event(connection: &Connection, event_id: &str) -> DbResult<Vec<Stop>> {
    let mut statement = connection.prepare(
        "SELECT id, kind, name, lat, lng, note FROM event_stops WHERE event_id = ?1 ORDER BY position",
    )?;
    let stops = statement
        .query_map([event_id], |row| {
            Ok(Stop {
                id: row.get(0)?,
                kind: StopKind::parse(&row.get::<_, String>(1)?),
                name: row.get(2)?,
                lat: row.get(3)?,
                lng: row.get(4)?,
                note: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(stops)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{self, NewEvent};
    use crate::{schema, tribes, users};

    #[test]
    fn stops_are_replaced_and_kept_in_order() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &NewEvent {
                title: "Skyline loop".to_string(),
                description: String::new(),
                place_name: "Park and ride".to_string(),
                lat: 47.6,
                lng: -122.3,
                starts_at: 2_000_000_000,
                tz_offset_minutes: 0,
            },
        )?;
        let stop = |kind, name: &str| NewStop {
            kind,
            name: name.to_string(),
            lat: 46.8,
            lng: -121.7,
            note: String::new(),
        };
        replace(
            &mut connection,
            &event.id,
            &[
                stop(StopKind::Stop, "Coffee"),
                stop(StopKind::Venue, "Paradise"),
            ],
        )?;
        replace(
            &mut connection,
            &event.id,
            &[
                stop(StopKind::Optional, "Viewpoint"),
                stop(StopKind::Venue, "Paradise"),
            ],
        )?;
        let saved = for_event(&connection, &event.id)?;
        let names: Vec<&str> = saved.iter().map(|stop| stop.name.as_str()).collect();
        assert_eq!(names, vec!["Viewpoint", "Paradise"]);
        assert_eq!(saved[0].kind, StopKind::Optional);
        assert_eq!(saved[1].kind, StopKind::Venue);
        Ok(())
    }
}
