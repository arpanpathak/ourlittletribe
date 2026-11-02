//! The feed: what people did in the tribes the viewer belongs to.

use rusqlite::types::Type;
use rusqlite::{Connection, Row, params};
use serde::Serialize;

use crate::ids::{ActivityId, EventId, ImageId, TribeId, UserId};
use crate::kinds::{Action, Target};
use crate::{DbResult, collect_rows, unix_now};

/// What an activity entry is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", content = "id", rename_all = "snake_case")]
pub enum About {
    /// A tribe.
    Tribe(TribeId),
    /// An event.
    Event(EventId),
}

impl About {
    fn target(&self) -> Target {
        match self {
            About::Tribe(_) => Target::Tribe,
            About::Event(_) => Target::Event,
        }
    }

    fn id(&self) -> &str {
        match self {
            About::Tribe(tribe_id) => tribe_id.as_str(),
            About::Event(event_id) => event_id.as_str(),
        }
    }

    fn from_columns(target: Target, id: String) -> About {
        match target {
            Target::Tribe => About::Tribe(TribeId::from(id)),
            Target::Event => About::Event(EventId::from(id)),
        }
    }
}

/// One entry in the feed.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityEntry {
    /// Entry id.
    pub id: ActivityId,
    /// Who did it.
    pub user_id: UserId,
    /// Their display name.
    pub user_name: String,
    /// Their profile picture.
    pub user_avatar: Option<ImageId>,
    /// What they did.
    pub action: Action,
    /// The tribe or event it was about.
    pub about: About,
    /// A sentence describing it, for display.
    pub summary: String,
    /// When it happened, Unix seconds.
    pub created_at: i64,
}

/// Adds an entry to the feed.
pub fn record(
    connection: &Connection,
    user_id: &UserId,
    action: Action,
    about: &About,
    summary: &str,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO activity_log (id, user_id, action, target_type, target_id, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![ActivityId::random(), user_id, action, about.target(), about.id(), summary, unix_now()],
    )?;
    Ok(())
}

fn read_entry(row: &Row<'_>) -> rusqlite::Result<ActivityEntry> {
    let target_text: String = row.get(4)?;
    let Ok(target) = target_text.parse::<Target>() else {
        return Err(rusqlite::Error::InvalidColumnType(
            4,
            target_text,
            Type::Text,
        ));
    };

    Ok(ActivityEntry {
        id: row.get(0)?,
        user_id: row.get(1)?,
        user_name: row.get(2)?,
        action: row.get(3)?,
        about: About::from_columns(target, row.get(5)?),
        summary: row.get(6)?,
        created_at: row.get(7)?,
        user_avatar: row.get(8)?,
    })
}

/// The latest entries about the tribes the viewer belongs to and their events, newest first.
pub fn recent_for(
    connection: &Connection,
    viewer_id: &UserId,
    limit: u32,
) -> DbResult<Vec<ActivityEntry>> {
    let mut statement = connection.prepare(
        "SELECT a.id, a.user_id, u.name, a.action, a.target_type, a.target_id, a.summary, a.created_at, u.avatar_image
         FROM activity_log a
         JOIN users u ON u.id = a.user_id
         WHERE (a.target_type = 'tribe' AND a.target_id IN
                  (SELECT tribe_id FROM tribe_members WHERE user_id = ?1))
            OR (a.target_type = 'event' AND a.target_id IN
                  (SELECT e.id FROM events e JOIN tribe_members m ON m.tribe_id = e.tribe_id WHERE m.user_id = ?1))
         ORDER BY a.created_at DESC
         LIMIT ?2",
    )?;
    collect_rows(statement.query_map(params![viewer_id, limit], read_entry)?)
}

/// Whether the person already has an entry with `action` about `about` since `since` (Unix seconds).
pub fn has_recent(
    connection: &Connection,
    user_id: &UserId,
    action: Action,
    about: &About,
    since: i64,
) -> DbResult<bool> {
    let found = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM activity_log
                        WHERE user_id = ?1 AND action = ?2 AND target_type = ?3 AND target_id = ?4 AND created_at > ?5)",
        params![user_id, action, about.target(), about.id(), since],
        |row| row.get(0),
    )?;
    Ok(found)
}
