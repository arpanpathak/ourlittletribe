//! Values with a fixed set of choices, stored as text in SQLite and written
//! as snake_case in JSON: a member's role, an RSVP, an item's scope and source,
//! a mark, and what an activity entry is about.

use std::fmt;
use std::str::FromStr;

use rusqlite::ToSql;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// Text that is not one of an enum's values.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{text:?} is not a valid {kind}")]
pub struct UnknownValue {
    /// What was being read, such as "role".
    pub kind: &'static str,
    /// The text that did not match.
    pub text: String,
}

/// Declares an enum whose variants are stored as fixed text.
macro_rules! text_enum {
    (
        $(#[$doc:meta])*
        $name:ident as $kind:literal {
            $($(#[$variant_doc:meta])* $variant:ident => $text:literal,)+
        }
    ) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($(#[$variant_doc])* $variant,)+
        }

        impl $name {
            /// The text stored for this value.
            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $text,)+
                }
            }
        }

        impl FromStr for $name {
            type Err = UnknownValue;

            fn from_str(text: &str) -> Result<$name, UnknownValue> {
                match text {
                    $($text => Ok($name::$variant),)+
                    _ => Err(UnknownValue { kind: $kind, text: text.to_string() }),
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.as_str()))
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<$name> {
                let text = value.as_str()?;
                text.parse().map_err(|error| FromSqlError::Other(Box::new(error)))
            }
        }
    };
}

text_enum! {
    /// What a person may do in a tribe.
    Role as "role" {
        /// Can edit the tribe and every event in it.
        Organizer => "organizer",
        /// Can plan events and add to lists.
        Member => "member",
    }
}

text_enum! {
    /// A person's answer to an event.
    Rsvp as "RSVP" {
        /// They will be there.
        Going => "going",
        /// They will not.
        NotGoing => "not_going",
    }
}

text_enum! {
    /// How many of an item the group needs.
    Scope as "scope" {
        /// One for each person going.
        Personal => "personal",
        /// One for the whole group.
        Shared => "shared",
    }
}

text_enum! {
    /// Who put an item on the list.
    ItemSource as "item source" {
        /// The planning model suggested it.
        Model => "model",
        /// A person added it.
        Person => "person",
    }
}

text_enum! {
    /// One person's progress on an item.
    MarkState as "mark" {
        /// They said they will bring it.
        Bringing => "bringing",
        /// They have it.
        Got => "got",
    }
}

text_enum! {
    /// What an activity entry is about.
    Target as "activity target" {
        /// A tribe.
        Tribe => "tribe",
        /// An event.
        Event => "event",
    }
}

text_enum! {
    /// What a person did, for the activity feed.
    Action as "activity action" {
        /// Started a tribe.
        StartedTribe => "started_tribe",
        /// Joined a tribe.
        JoinedTribe => "joined_tribe",
        /// Planned an event.
        PlannedEvent => "planned_event",
        /// Said they are going to an event.
        Going => "going",
        /// Asked the model for a packing list.
        PlannedItems => "planned_items",
        /// Shared photos from an event.
        SharedPhoto => "shared_photo",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_through_text_and_reject_others() {
        assert_eq!("not_going".parse::<Rsvp>(), Ok(Rsvp::NotGoing));
        assert_eq!(Rsvp::NotGoing.as_str(), "not_going");
        assert_eq!(Role::Organizer.to_string(), "organizer");

        let unknown = "maybe".parse::<Rsvp>();
        assert_eq!(
            unknown,
            Err(UnknownValue {
                kind: "RSVP",
                text: "maybe".to_string()
            })
        );
    }
}
