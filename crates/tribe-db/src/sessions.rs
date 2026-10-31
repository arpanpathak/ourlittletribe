//! Sign-in sessions. Only a hash of each session token is stored.

use rusqlite::{Connection, OptionalExtension, params};

use crate::DbResult;
use crate::users::{self, User};

/// Records a new session.
pub fn create(
    connection: &Connection,
    token_hash: &str,
    user_id: &str,
    expires_at: i64,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
        params![token_hash, user_id, expires_at],
    )?;
    Ok(())
}

/// The user a session belongs to, if the session exists and has not expired.
pub fn user_for(connection: &Connection, token_hash: &str, now: i64) -> DbResult<Option<User>> {
    let user_id: Option<String> = connection
        .query_row(
            "SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2",
            params![token_hash, now],
            |row| row.get(0),
        )
        .optional()?;
    match user_id {
        Some(user_id) => Ok(Some(users::get(connection, &user_id)?)),
        None => Ok(None),
    }
}

/// Ends a session.
pub fn delete(connection: &Connection, token_hash: &str) -> DbResult<()> {
    connection.execute("DELETE FROM sessions WHERE token_hash = ?1", [token_hash])?;
    Ok(())
}
