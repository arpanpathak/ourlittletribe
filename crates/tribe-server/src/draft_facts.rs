//! What is true about a drafted outing, for the model to write its
//! description from: the day, the real places found on the map, the drive
//! between them, the trail's grade, and what OpenStreetMap records about
//! the venue. A small model asked to describe a
//! trail from memory gets it wrong ("a strenuous scramble" for an old,
//! flat railway grade); given these facts, it does not have to guess.

use std::time::Duration;

use tribe_core::clock::weekday_of;
use tribe_core::itinerary::StopKind;
use tribe_places::address::PlaceMatch;
use tribe_places::trails::FoundTrail;

use crate::state::AppState;

/// How long each lookup may take before the description is written without it.
const FACT_WAIT: Duration = Duration::from_secs(6);

/// How far around the venue to look for its trail, metres.
const TRAIL_RADIUS_M: u32 = 2000;

/// Kilometres in a mile.
const KM_PER_MILE: f64 = 1.609_344;

/// A place in the drafted plan.
pub struct Planned<'a> {
    /// What it is for; `None` for the meeting point.
    pub kind: Option<StopKind>,
    /// What the model called it.
    pub query: &'a str,
    /// The real place, when the map has one.
    pub place: Option<&'a PlaceMatch>,
    /// A few words about it.
    pub note: &'a str,
}

impl Planned<'_> {
    fn label(&self) -> &'static str {
        match self.kind {
            Some(kind) => kind.label(),
            None => "Meeting point",
        }
    }

    /// One line, such as "Meeting point: Green Lake Park & Ride, Seattle,
    /// Washington", or what it was called when the map has no such place.
    fn line(&self) -> String {
        let label = self.label();
        let note = match self.note.trim() {
            "" => String::new(),
            note => format!(" ({note})"),
        };

        match self.place {
            Some(place) if place.detail.is_empty() => format!("{label}: {}{note}", place.name),
            Some(place) => format!("{label}: {}, {}{note}", place.name, place.detail),
            None => format!("{label}: {}, not found on the map{note}", self.query),
        }
    }
}

/// "Sunday 2026-11-08 at 07:00", or whatever part of it is known.
fn when_line(date: Option<&str>, time: Option<&str>) -> Option<String> {
    let day = date.map(|date| match weekday_of(date) {
        Some(weekday) => format!("{weekday} {date}"),
        None => date.to_string(),
    });

    match (day, time) {
        (Some(day), Some(time)) => Some(format!("Starts: {day} at {time}")),
        (Some(day), None) => Some(format!("Date: {day}")),
        (None, Some(time)) => Some(format!("Starts at {time}")),
        (None, None) => None,
    }
}

/// "about 2 h 15 min", or "about 40 min".
fn duration_words(minutes: f64) -> String {
    let rounded = (minutes / 5.0).round() as i64 * 5;
    let hours = rounded / 60;
    let left = rounded % 60;

    match (hours, left) {
        (0, minutes) => format!("about {minutes} min"),
        (hours, 0) => format!("about {hours} h"),
        (hours, minutes) => format!("about {hours} h {minutes} min"),
    }
}

/// The drive from the meeting point to the venue, by road.
async fn drive_line(state: &AppState, from: &PlaceMatch, to: &PlaceMatch) -> Option<String> {
    let routing = state.places.route(from.location, to.location);
    let route = tokio::time::timeout(FACT_WAIT, routing).await.ok()?.ok()?;
    let miles = route.distance_km / KM_PER_MILE;

    Some(format!(
        "Drive from {} to {}: {}, {miles:.0} miles ({:.0} km)",
        from.name,
        to.name,
        duration_words(route.duration_minutes),
        route.distance_km
    ))
}

/// Whether `trail` is the trail `venue` names: one name holds the other.
fn is_the_trail(trail: &FoundTrail, venue: &PlaceMatch) -> bool {
    let trail_name = trail.name.to_lowercase();
    let venue_name = venue.name.to_lowercase();

    trail_name.contains(&venue_name) || venue_name.contains(&trail_name)
}

/// The grade OpenStreetMap gives the venue's trail, when it is one.
async fn trail_line(state: &AppState, venue: &PlaceMatch) -> Option<String> {
    let looking = state.places.trails_near(venue.location, TRAIL_RADIUS_M);
    let trails = tokio::time::timeout(FACT_WAIT, looking).await.ok()?.ok()?;

    let trail = trails.iter().find(|trail| is_the_trail(trail, venue))?;
    let grade = trail.difficulty?;
    Some(format!(
        "Trail grade of {} on OpenStreetMap: {}",
        trail.name,
        grade.in_words()
    ))
}

/// What OpenStreetMap records about the venue, such as `railway=abandoned`
/// and `wheelchair=yes` for a trail on an old railway line.
async fn venue_record_line(state: &AppState, venue: &PlaceMatch) -> Option<String> {
    let reading = state.places.map_tags(&venue.name, venue.location);
    let tags = tokio::time::timeout(FACT_WAIT, reading).await.ok()?.ok()?;
    if tags.is_empty() {
        return None;
    }

    Some(format!(
        "OpenStreetMap tags of {}: {}",
        venue.name,
        tags.join(", ")
    ))
}

/// Everything known to be true about the plan, one fact per line.
pub async fn draft_facts(
    state: &AppState,
    date: Option<&str>,
    time: Option<&str>,
    planned: &[Planned<'_>],
) -> Vec<String> {
    let mut facts: Vec<String> = Vec::new();
    facts.extend(when_line(date, time));
    facts.extend(planned.iter().map(Planned::line));

    let meeting = planned
        .iter()
        .find(|place| place.kind.is_none())
        .and_then(|place| place.place);
    let venue = planned
        .iter()
        .find(|place| place.kind == Some(StopKind::Venue))
        .and_then(|place| place.place);

    let drive = async {
        match (meeting, venue) {
            (Some(from), Some(to)) => drive_line(state, from, to).await,
            _ => None,
        }
    };
    let trail = async {
        match venue {
            Some(venue) => trail_line(state, venue).await,
            None => None,
        }
    };

    let record = async {
        match venue {
            Some(venue) => venue_record_line(state, venue).await,
            None => None,
        }
    };

    let (drive, trail, record) = tokio::join!(drive, trail, record);
    facts.extend(drive);
    facts.extend(trail);
    facts.extend(record);
    facts
}

#[cfg(test)]
mod tests {
    use tribe_core::geo::LatLng;

    use super::*;

    fn place(name: &str, detail: &str) -> PlaceMatch {
        PlaceMatch {
            name: name.to_string(),
            detail: detail.to_string(),
            kind: String::new(),
            location: LatLng {
                lat: 47.7,
                lng: -121.2,
            },
        }
    }

    #[test]
    fn the_day_is_named() {
        assert_eq!(
            when_line(Some("2026-11-08"), Some("07:00")).as_deref(),
            Some("Starts: Sunday 2026-11-08 at 07:00")
        );
        assert_eq!(when_line(None, None), None);
    }

    #[test]
    fn drives_are_rounded_to_five_minutes() {
        assert_eq!(duration_words(132.0), "about 2 h 10 min");
        assert_eq!(duration_words(119.0), "about 2 h");
        assert_eq!(duration_words(38.0), "about 40 min");
    }

    #[test]
    fn places_say_where_they_are_or_that_they_were_not_found() {
        let found = place("Green Lake Park & Ride", "Seattle, Washington");
        let meeting = Planned {
            kind: None,
            query: "Greenlake Park and Ride",
            place: Some(&found),
            note: "",
        };
        assert_eq!(
            meeting.line(),
            "Meeting point: Green Lake Park & Ride, Seattle, Washington"
        );

        let lunch = Planned {
            kind: Some(StopKind::After),
            query: "Restaurant in Leavenworth",
            place: None,
            note: "lunch",
        };
        assert_eq!(
            lunch.line(),
            "After the event: Restaurant in Leavenworth, not found on the map (lunch)"
        );
    }
}
