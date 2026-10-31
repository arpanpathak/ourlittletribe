//! A feed of what people did: joined a tribe, planned an event, said they're going.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::{DbResult, new_id, unix_now};

/// One entry in the feed.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityEntry {
    /// Entry id.
    pub id: String,
    /// Who did it.
    pub user_id: String,
    /// Their display name.
    pub user_name: String,
    /// A short verb such as `joined_tribe`.
    pub action: String,
    /// `tribe` or `event`.
    pub target_type: String,
    /// The tribe or event id.
    pub target_id: String,
    /// A sentence describing it, for display.
    pub summary: String,
    /// When it happened.
    pub created_at: i64,
}

/// Adds an entry.
pub fn record(
    connection: &Connection,
    user_id: &str,
    action: &str,
    target_type: &str,
    target_id: &str,
    summary: &str,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO activity_log (id, user_id, action, target_type, target_id, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), user_id, action, target_type, target_id, summary, unix_now()],
    )?;
    Ok(())
}

/// The latest entries from tribes `viewer_id` belongs to, newest first.
pub fn recent_for(connection: &Connection, viewer_id: &str, limit: u32) -> DbResult<Vec<ActivityEntry>> {
    let mut statement = connection.prepare(
        "SELECT a.id, a.user_id, u.name, a.action, a.target_type, a.target_id, a.summary, a.created_at
         FROM activity_log a
         JOIN users u ON u.id = a.user_id
         WHERE (a.target_type = 'tribe' AND a.target_id IN
                  (SELECT tribe_id FROM tribe_members WHERE user_id = ?1))
            OR (a.target_type = 'event' AND a.target_id IN
                  (SELECT e.id FROM events e JOIN tribe_members m ON m.tribe_id = e.tribe_id WHERE m.user_id = ?1))
         ORDER BY a.created_at DESC
         LIMIT ?2",
    )?;
    let entries = statement
        .query_map(params![viewer_id, limit], |row| {
            Ok(ActivityEntry {
                id: row.get(0)?,
                user_id: row.get(1)?,
                user_name: row.get(2)?,
                action: row.get(3)?,
                target_type: row.get(4)?,
                target_id: row.get(5)?,
                summary: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}
