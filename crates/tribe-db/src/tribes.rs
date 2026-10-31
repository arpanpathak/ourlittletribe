//! Tribes and their members.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::{DbError, DbResult, new_id, unix_now};

/// A tribe as listed for one viewer.
#[derive(Debug, Clone, Serialize)]
pub struct Tribe {
    /// Tribe id.
    pub id: String,
    /// Who started it.
    pub creator_id: Option<String>,
    /// Name.
    pub name: String,
    /// What it is about.
    pub description: String,
    /// Where it usually meets.
    pub home_area: String,
    /// The illustration shown on its card: `peak`, `forest`, `wave`, `coffee`, `book`, `bike`.
    pub emblem: String,
    /// When it was started.
    pub created_at: i64,
    /// How many people belong.
    pub member_count: i64,
    /// Whether the viewer belongs.
    pub is_member: bool,
    /// Whether the viewer is an organizer.
    pub is_organizer: bool,
}

/// One member of a tribe.
#[derive(Debug, Clone, Serialize)]
pub struct Member {
    /// Account id.
    pub user_id: String,
    /// Display name.
    pub name: String,
    /// `organizer` or `member`.
    pub role: String,
    /// When they joined.
    pub joined_at: i64,
}

/// The illustrations a tribe may use.
pub const EMBLEMS: [&str; 6] = ["peak", "forest", "wave", "coffee", "book", "bike"];

const TRIBE_SELECT: &str = "SELECT t.id, t.creator_id, t.name, t.description, t.home_area, t.emblem, t.created_at,
        (SELECT COUNT(*) FROM tribe_members m WHERE m.tribe_id = t.id),
        EXISTS (SELECT 1 FROM tribe_members m WHERE m.tribe_id = t.id AND m.user_id = ?1),
        EXISTS (SELECT 1 FROM tribe_members m WHERE m.tribe_id = t.id AND m.user_id = ?1 AND m.role = 'organizer')
     FROM tribes t";

fn read_tribe(row: &Row<'_>) -> rusqlite::Result<Tribe> {
    Ok(Tribe {
        id: row.get(0)?,
        creator_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        home_area: row.get(4)?,
        emblem: row.get(5)?,
        created_at: row.get(6)?,
        member_count: row.get(7)?,
        is_member: row.get(8)?,
        is_organizer: row.get(9)?,
    })
}

/// Starts a tribe; its creator becomes an organizer.
pub fn create(
    connection: &mut Connection,
    creator_id: &str,
    name: &str,
    description: &str,
    home_area: &str,
    emblem: &str,
) -> DbResult<Tribe> {
    let id = new_id();
    let now = unix_now();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO tribes (id, creator_id, name, description, home_area, emblem, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, creator_id, name, description, home_area, emblem, now],
    )?;
    transaction.execute(
        "INSERT INTO tribe_members (tribe_id, user_id, role, joined_at) VALUES (?1, ?2, 'organizer', ?3)",
        params![id, creator_id, now],
    )?;
    transaction.commit()?;
    get(connection, &id, creator_id)
}

/// Every tribe, the viewer's own first, then the biggest.
pub fn list(connection: &Connection, viewer_id: &str) -> DbResult<Vec<Tribe>> {
    let sql = format!("{TRIBE_SELECT} ORDER BY 9 DESC, 8 DESC, t.created_at DESC LIMIT 200");
    let mut statement = connection.prepare(&sql)?;
    let tribes = statement
        .query_map([viewer_id], read_tribe)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tribes)
}

/// One tribe, as seen by the viewer.
pub fn get(connection: &Connection, tribe_id: &str, viewer_id: &str) -> DbResult<Tribe> {
    let sql = format!("{TRIBE_SELECT} WHERE t.id = ?2");
    connection
        .query_row(&sql, params![viewer_id, tribe_id], read_tribe)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// The tribe's members, organizers first.
pub fn members(connection: &Connection, tribe_id: &str) -> DbResult<Vec<Member>> {
    let mut statement = connection.prepare(
        "SELECT m.user_id, u.name, m.role, m.joined_at
         FROM tribe_members m JOIN users u ON u.id = m.user_id
         WHERE m.tribe_id = ?1
         ORDER BY m.role = 'organizer' DESC, m.joined_at",
    )?;
    let members = statement
        .query_map([tribe_id], |row| {
            Ok(Member {
                user_id: row.get(0)?,
                name: row.get(1)?,
                role: row.get(2)?,
                joined_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(members)
}

/// Whether `user_id` belongs to the tribe.
pub fn is_member(connection: &Connection, tribe_id: &str, user_id: &str) -> DbResult<bool> {
    let member = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM tribe_members WHERE tribe_id = ?1 AND user_id = ?2)",
        params![tribe_id, user_id],
        |row| row.get(0),
    )?;
    Ok(member)
}

/// Adds the user to the tribe; joining twice does nothing.
pub fn join(connection: &Connection, tribe_id: &str, user_id: &str) -> DbResult<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM tribes WHERE id = ?1)",
        [tribe_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(DbError::NotFound);
    }
    connection.execute(
        "INSERT OR IGNORE INTO tribe_members (tribe_id, user_id, role, joined_at) VALUES (?1, ?2, 'member', ?3)",
        params![tribe_id, user_id, unix_now()],
    )?;
    Ok(())
}

/// Removes the user from the tribe.
pub fn leave(connection: &Connection, tribe_id: &str, user_id: &str) -> DbResult<()> {
    connection.execute(
        "DELETE FROM tribe_members WHERE tribe_id = ?1 AND user_id = ?2",
        params![tribe_id, user_id],
    )?;
    Ok(())
}

/// The tribes a user belongs to.
pub fn for_user(connection: &Connection, user_id: &str) -> DbResult<Vec<Tribe>> {
    let sql = format!(
        "{TRIBE_SELECT} WHERE t.id IN (SELECT tribe_id FROM tribe_members WHERE user_id = ?1) ORDER BY t.name"
    );
    let mut statement = connection.prepare(&sql)?;
    let tribes = statement
        .query_map([user_id], read_tribe)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tribes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schema, users};

    #[test]
    fn creator_is_organizer_and_joiner_is_member() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;
        let tribe = create(&mut connection, &ada.id, "Cascade Walkers", "", "Seattle", "peak")?;
        assert!(tribe.is_organizer);
        assert_eq!(tribe.member_count, 1);

        join(&connection, &tribe.id, &bo.id)?;
        join(&connection, &tribe.id, &bo.id)?;
        let seen_by_bo = get(&connection, &tribe.id, &bo.id)?;
        assert!(seen_by_bo.is_member);
        assert!(!seen_by_bo.is_organizer);
        assert_eq!(seen_by_bo.member_count, 2);

        let roles: Vec<String> = members(&connection, &tribe.id)?.into_iter().map(|member| member.role).collect();
        assert_eq!(roles, vec!["organizer".to_string(), "member".to_string()]);

        leave(&connection, &tribe.id, &bo.id)?;
        assert!(!is_member(&connection, &tribe.id, &bo.id)?);
        Ok(())
    }

    #[test]
    fn joining_missing_tribe_is_not_found() -> DbResult<()> {
        let connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        assert!(matches!(join(&connection, "nope", &ada.id), Err(DbError::NotFound)));
        Ok(())
    }
}
