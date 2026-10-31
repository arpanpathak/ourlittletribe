//! Tribes and their members.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::ids::{ImageId, TribeId, UserId};
use crate::kinds::Role;
use crate::{DbError, DbResult, collect_rows, unix_now};

/// A tribe as one viewer sees it.
#[derive(Debug, Clone, Serialize)]
pub struct Tribe {
    /// Tribe id.
    pub id: TribeId,
    /// Who started it; empty once their account is deleted.
    pub creator_id: Option<UserId>,
    /// Name.
    pub name: String,
    /// What it is about, in Markdown.
    pub description: String,
    /// Where it usually meets.
    pub home_area: String,
    /// When it was started, Unix seconds.
    pub created_at: i64,
    /// How many people belong.
    pub member_count: i64,
    /// Whether the viewer belongs.
    pub is_member: bool,
    /// Whether the viewer is one of its organizers.
    pub is_organizer: bool,
    /// The cover picture, if one was uploaded.
    pub cover_image: Option<ImageId>,
}

/// One member of a tribe.
#[derive(Debug, Clone, Serialize)]
pub struct Member {
    /// Their account.
    pub user_id: UserId,
    /// Display name.
    pub name: String,
    /// Their profile picture.
    pub avatar: Option<ImageId>,
    /// What they may do in the tribe.
    pub role: Role,
    /// When they joined, Unix seconds.
    pub joined_at: i64,
}

/// The words of a tribe, as written when it is started or edited.
#[derive(Debug, Clone, Default)]
pub struct TribeText {
    /// Name.
    pub name: String,
    /// What it is about, in Markdown.
    pub description: String,
    /// Where it usually meets.
    pub home_area: String,
}

const TRIBE_SELECT: &str = "SELECT t.id, t.creator_id, t.name, t.description, t.home_area, t.created_at,
        (SELECT COUNT(*) FROM tribe_members m WHERE m.tribe_id = t.id),
        EXISTS (SELECT 1 FROM tribe_members m WHERE m.tribe_id = t.id AND m.user_id = ?1),
        EXISTS (SELECT 1 FROM tribe_members m WHERE m.tribe_id = t.id AND m.user_id = ?1 AND m.role = 'organizer'),
        (SELECT i.id FROM images i WHERE i.tribe_id = t.id AND i.purpose = 'tribe_cover' ORDER BY i.created_at DESC LIMIT 1)
     FROM tribes t";

fn read_tribe(row: &Row<'_>) -> rusqlite::Result<Tribe> {
    Ok(Tribe {
        id: row.get(0)?,
        creator_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        home_area: row.get(4)?,
        created_at: row.get(5)?,
        member_count: row.get(6)?,
        is_member: row.get(7)?,
        is_organizer: row.get(8)?,
        cover_image: row.get(9)?,
    })
}

fn read_member(row: &Row<'_>) -> rusqlite::Result<Member> {
    Ok(Member {
        user_id: row.get(0)?,
        name: row.get(1)?,
        role: row.get(2)?,
        joined_at: row.get(3)?,
        avatar: row.get(4)?,
    })
}

/// Starts a tribe; its creator becomes its first organizer.
pub fn create(
    connection: &mut Connection,
    creator_id: &UserId,
    text: &TribeText,
) -> DbResult<Tribe> {
    let tribe_id = TribeId::random();
    let now = unix_now();

    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO tribes (id, creator_id, name, description, home_area, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            tribe_id,
            creator_id,
            text.name,
            text.description,
            text.home_area,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO tribe_members (tribe_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)",
        params![tribe_id, creator_id, Role::Organizer, now],
    )?;
    transaction.commit()?;

    get(connection, &tribe_id, creator_id)
}

/// Changes a tribe's name, description and home area.
pub fn update(
    connection: &Connection,
    tribe_id: &TribeId,
    viewer_id: &UserId,
    text: &TribeText,
) -> DbResult<Tribe> {
    let changed = connection.execute(
        "UPDATE tribes SET name = ?2, description = ?3, home_area = ?4 WHERE id = ?1",
        params![tribe_id, text.name, text.description, text.home_area],
    )?;

    match changed {
        0 => Err(DbError::NotFound),
        _ => get(connection, tribe_id, viewer_id),
    }
}

/// One tribe, as the viewer sees it.
pub fn get(connection: &Connection, tribe_id: &TribeId, viewer_id: &UserId) -> DbResult<Tribe> {
    let sql = format!("{TRIBE_SELECT} WHERE t.id = ?2");
    connection
        .query_row(&sql, params![viewer_id, tribe_id], read_tribe)
        .optional()?
        .ok_or(DbError::NotFound)
}

/// Every tribe: the viewer's own first, then the biggest, then the newest.
pub fn list(connection: &Connection, viewer_id: &UserId) -> DbResult<Vec<Tribe>> {
    let sql = format!("{TRIBE_SELECT} ORDER BY 8 DESC, 7 DESC, t.created_at DESC LIMIT 200");
    let mut statement = connection.prepare(&sql)?;
    collect_rows(statement.query_map([viewer_id], read_tribe)?)
}

/// The tribes a person belongs to, by name.
pub fn for_user(connection: &Connection, user_id: &UserId) -> DbResult<Vec<Tribe>> {
    let sql = format!(
        "{TRIBE_SELECT} WHERE t.id IN (SELECT tribe_id FROM tribe_members WHERE user_id = ?1) ORDER BY t.name"
    );
    let mut statement = connection.prepare(&sql)?;
    collect_rows(statement.query_map([user_id], read_tribe)?)
}

/// The tribe's members, organizers first, then by when they joined.
pub fn members(connection: &Connection, tribe_id: &TribeId) -> DbResult<Vec<Member>> {
    let mut statement = connection.prepare(
        "SELECT m.user_id, u.name, m.role, m.joined_at, u.avatar_image
         FROM tribe_members m JOIN users u ON u.id = m.user_id
         WHERE m.tribe_id = ?1
         ORDER BY m.role = 'organizer' DESC, m.joined_at",
    )?;
    collect_rows(statement.query_map([tribe_id], read_member)?)
}

/// The person's role in the tribe, or `None` when they do not belong.
pub fn role_of(
    connection: &Connection,
    tribe_id: &TribeId,
    user_id: &UserId,
) -> DbResult<Option<Role>> {
    let role = connection
        .query_row(
            "SELECT role FROM tribe_members WHERE tribe_id = ?1 AND user_id = ?2",
            params![tribe_id, user_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(role)
}

/// Adds a person to the tribe as a member; joining twice does nothing.
pub fn join(connection: &Connection, tribe_id: &TribeId, user_id: &UserId) -> DbResult<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM tribes WHERE id = ?1)",
        [tribe_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(DbError::NotFound);
    }

    connection.execute(
        "INSERT OR IGNORE INTO tribe_members (tribe_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)",
        params![tribe_id, user_id, Role::Member, unix_now()],
    )?;
    Ok(())
}

/// Removes a person from the tribe.
pub fn leave(connection: &Connection, tribe_id: &TribeId, user_id: &UserId) -> DbResult<()> {
    connection.execute(
        "DELETE FROM tribe_members WHERE tribe_id = ?1 AND user_id = ?2",
        params![tribe_id, user_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schema, users};

    fn walkers() -> TribeText {
        TribeText {
            name: "Cascade Walkers".to_string(),
            home_area: "Seattle".to_string(),
            ..TribeText::default()
        }
    }

    #[test]
    fn creator_is_organizer_and_joiner_is_member() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let bo = users::create(&connection, "b@example.com", "Bo", "hash")?;

        let tribe = create(&mut connection, &ada.id, &walkers())?;
        assert!(tribe.is_organizer);
        assert_eq!(tribe.member_count, 1);

        join(&connection, &tribe.id, &bo.id)?;
        join(&connection, &tribe.id, &bo.id)?;
        let seen_by_bo = get(&connection, &tribe.id, &bo.id)?;
        assert!(seen_by_bo.is_member);
        assert!(!seen_by_bo.is_organizer);
        assert_eq!(seen_by_bo.member_count, 2);

        let roles: Vec<Role> = members(&connection, &tribe.id)?
            .into_iter()
            .map(|member| member.role)
            .collect();
        assert_eq!(roles, vec![Role::Organizer, Role::Member]);
        assert_eq!(role_of(&connection, &tribe.id, &bo.id)?, Some(Role::Member));

        let renamed = TribeText {
            name: "Cascade Striders".to_string(),
            ..walkers()
        };
        assert_eq!(
            update(&connection, &tribe.id, &ada.id, &renamed)?.name,
            "Cascade Striders"
        );

        leave(&connection, &tribe.id, &bo.id)?;
        assert_eq!(role_of(&connection, &tribe.id, &bo.id)?, None);
        Ok(())
    }

    #[test]
    fn joining_a_missing_tribe_is_not_found() -> DbResult<()> {
        let connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;

        let missing = TribeId::from("nope");
        assert!(matches!(
            join(&connection, &missing, &ada.id),
            Err(DbError::NotFound)
        ));
        Ok(())
    }
}
