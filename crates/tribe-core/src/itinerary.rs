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
    /// Everyone stops there on the way, such as a coffee or a trailhead.
    Stop,
    /// Some may stop there, such as a viewpoint or a store.
    Optional,
    /// Where the event itself happens, when that is not the meeting point.
    Venue,
}

impl StopKind {
    /// The text stored in the database and used in prompts.
    pub fn as_str(self) -> &'static str {
        match self {
            StopKind::Stop => "stop",
            StopKind::Optional => "optional",
            StopKind::Venue => "venue",
        }
    }

    /// How a person would say it, such as "Stop on the way".
    pub fn label(self) -> &'static str {
        match self {
            StopKind::Stop => "Stop on the way",
            StopKind::Optional => "Optional stop",
            StopKind::Venue => "Event venue",
        }
    }

    /// The kind stored as `text`, or `None` for anything else.
    pub fn parse(text: &str) -> Option<StopKind> {
        match text {
            "stop" => Some(StopKind::Stop),
            "optional" => Some(StopKind::Optional),
            "venue" => Some(StopKind::Venue),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip_through_text() {
        for kind in [StopKind::Stop, StopKind::Optional, StopKind::Venue] {
            assert_eq!(StopKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(StopKind::parse("detour"), None);
    }
}
