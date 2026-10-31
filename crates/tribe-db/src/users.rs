//! Accounts.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::ids::{ImageId, UserId};
use crate::{DbError, DbResult, unique_violation_as_exists, unix_now};

/// A person with an account.
#[derive(Debug, Clone, Serialize)]
pub struct User {
    /// Account id.
    pub id: UserId,
    /// Sign-in email; empty when the user is shown to someone else.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub email: String,
    /// Display name.
    pub name: String,
    /// A short self-description.
    pub bio: String,
    /// A neighbourhood or town, written by the person.
    pub home_area: String,
    /// Whether this account may manage every tribe and event.
    pub is_admin: bool,
    /// When the account was made, Unix seconds.
    pub created_at: i64,
    /// The profile picture, if one was uploaded.
    pub avatar: Option<ImageId>,
    /// The profile banner, if one was uploaded.
    pub cover_image: Option<ImageId>,
}

impl User {
    /// The same user with the email removed, for showing to other people.
    pub fn public(mut self) -> User {
        self.email.clear();
        self
    }
}

/// What a person writes about themselves.
#[derive(Debug, Clone, Default)]
pub struct Profile {
    /// Display name.
    pub name: String,
    /// A short self-description.
    pub bio: String,
    /// A neighbourhood or town.
    pub home_area: String,
}

/// An account and its password hash, for checking a sign-in.
#[derive(Debug, Clone)]
pub struct Credentials {
    /// The account.
    pub user: User,
    /// The stored Argon2 password hash.
    pub password_hash: String,
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

/// Creates an account. The first account on a server becomes its admin.
pub fn create(
    connection: &Connection,
    email: &str,
    name: &str,
    password_hash: &str,
) -> DbResult<User> {
    let existing: i64 = connection.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
    let is_admin = existing == 0;
    let user_id = UserId::random();

    connection
        .execute(
            "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![user_id, email, name, password_hash, is_admin, unix_now()],
        )
        .map_err(unique_violation_as_exists)?;

    get(connection, &user_id)
}

/// Looks up an account by id.
pub fn get(connection: &Connection, user_id: &UserId) -> DbResult<User> {
    let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = ?1");
    connection
        .query_row(&sql, [user_id], read_user)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Looks up an account and its password hash by email, ignoring case.
pub fn credentials(connection: &Connection, email: &str) -> DbResult<Option<Credentials>> {
    let sql = format!("SELECT {USER_COLUMNS}, password_hash FROM users WHERE email = ?1");
    let read_credentials = |row: &Row<'_>| {
        Ok(Credentials {
            user: read_user(row)?,
            password_hash: row.get(9)?,
        })
    };

    let found = connection
        .query_row(&sql, [email], read_credentials)
        .optional()?;
    Ok(found)
}

/// Changes what a person writes about themselves.
pub fn update_profile(
    connection: &Connection,
    user_id: &UserId,
    profile: &Profile,
) -> DbResult<User> {
    let changed = connection.execute(
        "UPDATE users SET name = ?2, bio = ?3, home_area = ?4 WHERE id = ?1",
        params![user_id, profile.name, profile.bio, profile.home_area],
    )?;

    match changed {
        0 => Err(DbError::NotFound),
        _ => get(connection, user_id),
    }
}

/// Sets or clears one of a person's pictures. Returns the picture it replaced,
/// so the caller can delete its files.
pub fn set_picture(
    connection: &Connection,
    user_id: &UserId,
    which: ProfilePicture,
    image_id: Option<&ImageId>,
) -> DbResult<Option<ImageId>> {
    let column = which.column();

    let previous: Option<ImageId> = connection
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
    fn credentials_hold_the_hash() -> DbResult<()> {
        let connection = connection()?;
        create(&connection, "a@example.com", "Ada", "the-hash")?;

        let Some(found) = credentials(&connection, "A@EXAMPLE.COM")? else {
            panic!("user not found");
        };

        assert_eq!(found.user.name, "Ada");
        assert_eq!(found.password_hash, "the-hash");
        Ok(())
    }

    #[test]
    fn setting_a_picture_returns_the_one_it_replaced() -> DbResult<()> {
        let connection = connection()?;
        let ada = create(&connection, "a@example.com", "Ada", "hash")?;
        let first = ImageId::random();
        let second = ImageId::random();

        assert_eq!(
            set_picture(&connection, &ada.id, ProfilePicture::Avatar, Some(&first))?,
            None
        );
        let replaced = set_picture(&connection, &ada.id, ProfilePicture::Avatar, Some(&second))?;

        assert_eq!(replaced, Some(first));
        let ada = get(&connection, &ada.id)?;
        assert_eq!(ada.avatar, Some(second));
        assert_eq!(ada.cover_image, None);
        Ok(())
    }
}
