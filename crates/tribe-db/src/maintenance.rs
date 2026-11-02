//! Clean-up that runs every hour.

use rusqlite::{Connection, params};

use crate::DbResult;

/// Events are kept this long after they start, then deleted with everything attached.
pub const EVENT_RETENTION_SECONDS: i64 = 365 * 24 * 3600;

/// Trip starting points are deleted this long after the event starts.
pub const ORIGIN_RETENTION_SECONDS: i64 = 24 * 3600;

/// Cached stores not refreshed for this long are dropped.
pub const STORE_RETENTION_SECONDS: i64 = 90 * 24 * 3600;

/// What one clean-up removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PurgeReport {
    /// Events that started more than a year ago.
    pub events: usize,
    /// Trip starting points of events that are over.
    pub origins: usize,
    /// Expired sessions.
    pub sessions: usize,
    /// Stale cached stores.
    pub stores: usize,
}

/// Deletes old events, finished trips' starting points, expired sessions and stale stores.
pub fn purge(connection: &Connection, now: i64) -> DbResult<PurgeReport> {
    let events = connection.execute(
        "DELETE FROM events WHERE starts_at < ?1",
        params![now - EVENT_RETENTION_SECONDS],
    )?;
    let origins = connection.execute(
        "DELETE FROM trip_origins WHERE event_id IN (SELECT id FROM events WHERE starts_at < ?1)",
        params![now - ORIGIN_RETENTION_SECONDS],
    )?;
    let sessions =
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
    let stores = connection.execute(
        "DELETE FROM stores WHERE updated_at < ?1",
        params![now - STORE_RETENTION_SECONDS],
    )?;
    Ok(PurgeReport {
        events,
        origins,
        sessions,
        stores,
    })
}
