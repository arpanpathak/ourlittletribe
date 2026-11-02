//! The places an event goes: a named meeting point, and stops of three kinds.

use serde::{Deserialize, Serialize};

use crate::geo::LatLng;

/// A point on the map with the name people know it by.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    /// What people call it, such as "Issaquah Park and Ride".
    pub name: String,
    /// Where it is; written as `lat` and `lng` beside `name` in JSON.
    #[serde(flatten)]
    pub point: LatLng,
}

/// What a place on an event's plan is for, besides the meeting point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopKind {
    /// Another place to meet, for people coming from elsewhere, such as a
    /// park-and-ride in another town.
    Pickup,
    /// Everyone stops there on the way, such as a coffee or a trailhead.
    Stop,
    /// Some may stop there, such as a viewpoint or a store.
    Optional,
    /// Where the event itself happens, when that is not the meeting point.
    Venue,
    /// Somewhere to go after the event, such as lunch.
    After,
}

impl StopKind {
    /// The text stored in the database and used in prompts.
    pub fn as_str(self) -> &'static str {
        match self {
            StopKind::Pickup => "pickup",
            StopKind::Stop => "stop",
            StopKind::Optional => "optional",
            StopKind::Venue => "venue",
            StopKind::After => "after",
        }
    }

    /// How a person would say it, such as "Stop on the way".
    pub fn label(self) -> &'static str {
        match self {
            StopKind::Pickup => "Also meeting at",
            StopKind::Stop => "Stop on the way",
            StopKind::Optional => "Optional stop",
            StopKind::Venue => "Event venue",
            StopKind::After => "After the event",
        }
    }

    /// The kind stored as `text`, or `None` for anything else.
    pub fn parse(text: &str) -> Option<StopKind> {
        match text {
            "pickup" => Some(StopKind::Pickup),
            "stop" => Some(StopKind::Stop),
            "optional" => Some(StopKind::Optional),
            "venue" => Some(StopKind::Venue),
            "after" => Some(StopKind::After),
            _ => None,
        }
    }

    /// Where the kind sits in an itinerary, after the meeting point: other
    /// meeting points first, then stops on the way, the venue, and what
    /// comes after. Places of one stage keep the planner's order.
    pub fn stage(self) -> u8 {
        match self {
            StopKind::Pickup => 0,
            StopKind::Stop | StopKind::Optional => 1,
            StopKind::Venue => 2,
            StopKind::After => 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip_through_text() {
        let every = [
            StopKind::Pickup,
            StopKind::Stop,
            StopKind::Optional,
            StopKind::Venue,
            StopKind::After,
        ];
        for kind in every {
            assert_eq!(StopKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(StopKind::parse("detour"), None);
    }

    #[test]
    fn other_meeting_points_come_first_and_lunch_last() {
        let mut kinds = vec![
            StopKind::After,
            StopKind::Venue,
            StopKind::Stop,
            StopKind::Pickup,
        ];
        kinds.sort_by_key(|kind| kind.stage());

        assert_eq!(
            kinds,
            vec![
                StopKind::Pickup,
                StopKind::Stop,
                StopKind::Venue,
                StopKind::After
            ]
        );
    }
}
