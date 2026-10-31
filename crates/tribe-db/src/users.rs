//! Accounts.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::{DbError, DbResult, new_id, unique_violation_as_exists, unix_now};

/// A person with an account.
#[derive(Debug, Clone, Serialize)]
pub struct User {
    /// Account id.
    pub id: String,
    /// Sign-in email; shown only to the person themselves.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub email: String,
    /// Display name.
    pub name: String,
    /// A short self-description.
    pub bio: String,
    /// A neighbourhood or town, written by the person.
    pub home_area: String,
    /// Whether this account can verify merchants.
    pub is_admin: bool,
    /// When the account was made.
    pub created_at: i64,
    /// The profile picture's id, if one was uploaded.
    pub avatar: Option<String>,
    /// The profile banner's id, if one was uploaded.
    pub cover_image: Option<String>,
}

/// Which of a person's own pictures to change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfilePicture {
    /// The round picture shown next to their name.
    Avatar,
    /// The banner at the top of their profile.
    Cover,
}

impl ProfilePicture {
    fn column(self) -> &'static str {
        match self {
            ProfilePicture::Avatar => "avatar_image",
            ProfilePicture::Cover => "cover_image",
        }
    }
}

impl User {
    /// The same user with the email removed, for showing to other people.
    pub fn public(mut self) -> User {
        self.email.clear();
        self
    }
}

const USER_COLUMNS: &str =
    "id, email, name, bio, home_area, is_admin, created_at, avatar_image, cover_image";

fn read_user(row: &Row<'_>) -> rusqlite::Result<User> {
    Ok(User {
        id: row.get(0)?,
        email: row.get(1)?,
        name: row.get(2)?,
        bio: row.get(3)?,
        home_area: row.get(4)?,
        is_admin: row.get(5)?,
        created_at: row.get(6)?,
        avatar: row.get(7)?,
        cover_image: row.get(8)?,
    })
}

/// Creates an account. The first account on an instance becomes its admin.
pub fn create(
    connection: &Connection,
    email: &str,
    name: &str,
    password_hash: &str,
) -> DbResult<User> {
    let existing: i64 = connection.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
    let is_admin = existing == 0;
    let id = new_id();
    connection
        .execute(
            "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, email, name, password_hash, is_admin, unix_now()],
        )
        .map_err(unique_violation_as_exists)?;
    get(connection, &id)
}

/// Looks up a user by id.
pub fn get(connection: &Connection, user_id: &str) -> DbResult<User> {
    let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1");
    connection
        .query_row(&sql, [user_id], read_user)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Looks up a user and their password hash by email, for signing in.
pub fn find_for_sign_in(connection: &Connection, email: &str) -> DbResult<Option<(User, String)>> {
    let sql = format!("SELECT {USER_COLUMNS}, password_hash FROM users WHERE email = ?1");
    let found = connection
        .query_row(&sql, [email], |row| {
            Ok((read_user(row)?, row.get::<_, String>(9)?))
        })
        .optional()?;
    Ok(found)
}

/// Changes the name, bio and home area of an account.
pub fn update_profile(
    connection: &Connection,
    user_id: &str,
    name: &str,
    bio: &str,
    home_area: &str,
) -> DbResult<User> {
    let changed = connection.execute(
        "UPDATE users SET name = ?2, bio = ?3, home_area = ?4 WHERE id = ?1",
        params![user_id, name, bio, home_area],
    )?;
    match changed {
        0 => Err(DbError::NotFound),
        _ => get(connection, user_id),
    }
}

/// Sets or clears one of a person's pictures and returns the id it replaced,
/// so the caller can delete that file.
pub fn set_picture(
    connection: &Connection,
    user_id: &str,
    which: ProfilePicture,
    image_id: Option<&str>,
) -> DbResult<Option<String>> {
    let column = which.column();
    let previous: Option<String> = connection
        .query_row(
            &format!("SELECT {column} FROM users WHERE id = ?1"),
            [user_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(DbError::NotFound)?;
    connection.execute(
        &format!("UPDATE users SET {column} = ?2 WHERE id = ?1"),
        params![user_id, image_id],
    )?;
    Ok(previous)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;

    fn connection() -> DbResult<Connection> {
        let connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        Ok(connection)
    }

    #[test]
    fn first_user_is_admin_and_second_is_not() -> DbResult<()> {
        let connection = connection()?;
        let first = create(&connection, "a@example.com", "Ada", "hash")?;
        let second = create(&connection, "b@example.com", "Bo", "hash")?;
        assert!(first.is_admin);
        assert!(!second.is_admin);
        Ok(())
    }

    #[test]
    fn email_is_unique_ignoring_case() -> DbResult<()> {
        let connection = connection()?;
        create(&connection, "a@example.com", "Ada", "hash")?;
        let duplicate = create(&connection, "A@Example.com", "Ada again", "hash");
        assert!(matches!(duplicate, Err(DbError::AlreadyExists)));
        Ok(())
    }

    #[test]
    fn sign_in_lookup_returns_hash() -> DbResult<()> {
        let connection = connection()?;
        create(&connection, "a@example.com", "Ada", "the-hash")?;
        let Some((user, hash)) = find_for_sign_in(&connection, "A@EXAMPLE.COM")? else {
            panic!("user not found");
        };
        assert_eq!(user.name, "Ada");
        assert_eq!(hash, "the-hash");
        Ok(())
    }

    #[test]
    fn setting_a_picture_returns_the_one_it_replaced() -> DbResult<()> {
        let connection = connection()?;
        let ada = create(&connection, "a@example.com", "Ada", "hash")?;
        assert_eq!(
            set_picture(&connection, &ada.id, ProfilePicture::Avatar, Some("first"))?,
            None
        );
        let replaced = set_picture(&connection, &ada.id, ProfilePicture::Avatar, Some("second"))?;
        assert_eq!(replaced.as_deref(), Some("first"));
        let ada = get(&connection, &ada.id)?;
        assert_eq!(ada.avatar.as_deref(), Some("second"));
        assert_eq!(ada.cover_image, None);
        Ok(())
    }
}
