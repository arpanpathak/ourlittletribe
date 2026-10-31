//! Typed ids. Every row's id is a random UUID stored as text; each table gets
//! its own id type, so an event id can never be passed where a user id is
//! expected.

use std::fmt;

use rusqlite::ToSql;
use rusqlite::types::{FromSql, FromSqlResult, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// Declares an id type: a UUID string with conversions to and from SQLite,
/// JSON and text.
macro_rules! id_type {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// A new random id.
            pub fn random() -> $name {
                $name(uuid::Uuid::new_v4().to_string())
            }

            /// The id as text.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<String> for $name {
            fn from(text: String) -> $name {
                $name(text)
            }
        }

        impl From<&str> for $name {
            fn from(text: &str) -> $name {
                $name(text.to_string())
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                self.0.to_sql()
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<$name> {
                String::column_result(value).map($name)
            }
        }
    };
}

id_type! {
    /// A person's account.
    UserId
}

id_type! {
    /// A tribe: a group that plans outings together.
    TribeId
}

id_type! {
    /// An event: one outing.
    EventId
}

id_type! {
    /// A stop on an event's plan.
    StopId
}

id_type! {
    /// An item on an event's packing list.
    ItemId
}

id_type! {
    /// An uploaded picture; also the name of its files.
    ImageId
}

id_type! {
    /// A shop remembered from OpenStreetMap.
    StoreId
}

id_type! {
    /// One line of the activity feed.
    ActivityId
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_random_uuids_and_round_trip_as_json() -> Result<(), serde_json::Error> {
        let first = EventId::random();
        let second = EventId::random();
        assert_ne!(first, second);
        assert_eq!(first.as_str().len(), 36);

        let json = serde_json::to_string(&first)?;
        assert_eq!(json, format!("\"{first}\""));
        let back: EventId = serde_json::from_str(&json)?;
        assert_eq!(back, first);
        Ok(())
    }
}
