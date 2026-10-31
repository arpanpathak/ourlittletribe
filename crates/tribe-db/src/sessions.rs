//! Sign-in sessions. Only a hash of each session token is stored, so a copy of
//! the database cannot be used to sign in.

use rusqlite::{Connection, OptionalExtension, params};

use crate::DbResult;
use crate::ids::UserId;
use crate::users::{self, User};

/// The SHA-256 of a session token, as hex: the only form in which a token is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenHash(pub String);

/// Records a new session for a person, valid until `expires_at` (Unix seconds).
pub fn create(
    connection: &Connection,
    token_hash: &TokenHash,
    user_id: &UserId,
    expires_at: i64,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
        params![token_hash.0, user_id, expires_at],
    )?;
    Ok(())
}

/// The person a session belongs to, if it exists and has not expired.
pub fn user_for(
    connection: &Connection,
    token_hash: &TokenHash,
    now: i64,
) -> DbResult<Option<User>> {
    let user_id: Option<UserId> = connection
        .query_row(
            "SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2",
            params![token_hash.0, now],
            |row| row.get(0),
        )
        .optional()?;

    let Some(user_id) = user_id else {
        return Ok(None);
    };
    Ok(Some(users::get(connection, &user_id)?))
}

/// Ends a session.
pub fn delete(connection: &Connection, token_hash: &TokenHash) -> DbResult<()> {
    connection.execute(
        "DELETE FROM sessions WHERE token_hash = ?1",
        [&token_hash.0],
    )?;
    Ok(())
}
