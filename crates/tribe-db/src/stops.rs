//! The places an event goes besides where people meet: stops on the way,
//! optional stops, and the venue. They are kept in the order the planner set;
//! the meeting point is the event's own place.

use rusqlite::types::Type;
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;
use tribe_core::itinerary::{Place, StopKind};

use crate::ids::{EventId, StopId};
use crate::{DbResult, collect_rows};

/// A stop to save.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NewStop {
    /// What it is for.
    pub kind: StopKind,
    /// Where it is; written as `name`, `lat` and `lng` in JSON.
    #[serde(flatten)]
    pub place: Place,
    /// A line from the planner, such as "Coffee and restrooms, 15 min".
    #[serde(default)]
    pub note: String,
}

/// A saved stop.
#[derive(Debug, Clone, Serialize)]
pub struct Stop {
    /// Stop id.
    pub id: StopId,
    /// What it is for.
    pub kind: StopKind,
    /// Where it is; written as `name`, `lat` and `lng` in JSON.
    #[serde(flatten)]
    pub place: Place,
    /// A line from the planner.
    pub note: String,
}

impl Stop {
    /// Whether this stop is the event's venue.
    pub fn is_venue(&self) -> bool {
        self.kind == StopKind::Venue
    }
}

fn read_stop(row: &Row<'_>) -> rusqlite::Result<Stop> {
    let kind_text: String = row.get(1)?;
    let Some(kind) = StopKind::parse(&kind_text) else {
        return Err(rusqlite::Error::InvalidColumnType(1, kind_text, Type::Text));
    };

    Ok(Stop {
        id: row.get(0)?,
        kind,
        place: Place {
            name: row.get(2)?,
            point: LatLng {
                lat: row.get(3)?,
                lng: row.get(4)?,
            },
        },
        note: row.get(5)?,
    })
}

/// Replaces an event's stops with `stops`, in that order.
pub fn replace(connection: &mut Connection, event_id: &EventId, stops: &[NewStop]) -> DbResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM event_stops WHERE event_id = ?1", [event_id])?;

    for (position, stop) in (0_i64..).zip(stops) {
        transaction.execute(
            "INSERT INTO event_stops (id, event_id, kind, name, lat, lng, note, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                StopId::random(),
                event_id,
                stop.kind.as_str(),
                stop.place.name,
                stop.place.point.lat,
                stop.place.point.lng,
                stop.note,
                position
            ],
        )?;
    }

    transaction.commit()?;
    Ok(())
}

/// An event's stops, in order.
pub fn for_event(connection: &Connection, event_id: &EventId) -> DbResult<Vec<Stop>> {
    let mut statement =
        connection.prepare("SELECT id, kind, name, lat, lng, note FROM event_stops WHERE event_id = ?1 ORDER BY position")?;
    collect_rows(statement.query_map([event_id], read_stop)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events;
    use crate::events::tests::{ada_and_her_tribe, skyline_trail};
    use crate::unix_now;

    fn stop(kind: StopKind, name: &str) -> NewStop {
        NewStop {
            kind,
            place: Place {
                name: name.to_string(),
                point: LatLng {
                    lat: 46.8,
                    lng: -121.7,
                },
            },
            note: String::new(),
        }
    }

    #[test]
    fn stops_are_replaced_and_kept_in_order() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;

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
        let names: Vec<&str> = saved.iter().map(|stop| stop.place.name.as_str()).collect();
        assert_eq!(names, vec!["Viewpoint", "Paradise"]);
        assert_eq!(saved[0].kind, StopKind::Optional);
        assert!(saved[1].is_venue());
        Ok(())
    }
}
