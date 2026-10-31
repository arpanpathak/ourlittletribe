//! Pictures people upload: an event's cover, a tribe's cover, and photos from an event.
//!
//! The picture files live on disk (see `tribe-media`); these rows say what each
//! one belongs to. A cover is the newest `*_cover` row of its event or tribe.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::{DbError, DbResult, unix_now};

/// What a picture is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// The banner at the top of an event.
    EventCover,
    /// A photo someone shared from an event.
    EventPhoto,
    /// The banner at the top of a tribe.
    TribeCover,
}

impl Purpose {
    /// The name stored in the database.
    pub fn as_str(self) -> &'static str {
        match self {
            Purpose::EventCover => "event_cover",
            Purpose::EventPhoto => "event_photo",
            Purpose::TribeCover => "tribe_cover",
        }
    }

    fn parse(text: &str) -> Option<Purpose> {
        match text {
            "event_cover" => Some(Purpose::EventCover),
            "event_photo" => Some(Purpose::EventPhoto),
            "tribe_cover" => Some(Purpose::TribeCover),
            _ => None,
        }
    }
}

/// What a picture belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Owner {
    /// An event, by id.
    Event(String),
    /// A tribe, by id.
    Tribe(String),
}

/// A stored picture's row.
#[derive(Debug, Clone)]
pub struct ImageRecord {
    /// Picture id; also its file name.
    pub id: String,
    /// Who uploaded it.
    pub uploader_id: Option<String>,
    /// What it is for.
    pub purpose: Purpose,
    /// What it belongs to.
    pub owner: Owner,
}

/// A photo shared from an event, for its gallery.
#[derive(Debug, Clone, Serialize)]
pub struct Photo {
    /// Picture id.
    pub id: String,
    /// Who shared it.
    pub uploader_id: Option<String>,
    /// Their name.
    pub uploader_name: String,
    /// A line about it.
    pub caption: String,
    /// Width of the large copy.
    pub width: u32,
    /// Height of the large copy.
    pub height: u32,
    /// When it was shared.
    pub created_at: i64,
}

/// What a new picture row holds.
#[derive(Debug, Clone)]
pub struct NewImage<'a> {
    /// Picture id, made by the caller so the file and the row match.
    pub id: &'a str,
    /// Who uploaded it.
    pub uploader_id: &'a str,
    /// What it is for.
    pub purpose: Purpose,
    /// What it belongs to.
    pub owner: Owner,
    /// A line about it.
    pub caption: &'a str,
    /// Width of the large copy.
    pub width: u32,
    /// Height of the large copy.
    pub height: u32,
}

fn owner_columns(owner: &Owner) -> (Option<&str>, Option<&str>) {
    match owner {
        Owner::Event(event_id) => (Some(event_id.as_str()), None),
        Owner::Tribe(tribe_id) => (None, Some(tribe_id.as_str())),
    }
}

/// Records a picture. For a cover, any earlier cover of the same event or tribe
/// is deleted, and their ids are returned so the caller can delete the files.
pub fn add(connection: &mut Connection, image: &NewImage<'_>) -> DbResult<Vec<String>> {
    let (event_id, tribe_id) = owner_columns(&image.owner);
    let transaction = connection.transaction()?;
    let mut replaced = Vec::new();
    if matches!(image.purpose, Purpose::EventCover | Purpose::TribeCover) {
        replaced = cover_ids(&transaction, image.purpose, &image.owner)?;
        transaction.execute(
            "DELETE FROM images WHERE purpose = ?1 AND event_id IS ?2 AND tribe_id IS ?3",
            params![image.purpose.as_str(), event_id, tribe_id],
        )?;
    }
    transaction.execute(
        "INSERT INTO images (id, uploader_id, purpose, event_id, tribe_id, caption, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            image.id,
            image.uploader_id,
            image.purpose.as_str(),
            event_id,
            tribe_id,
            image.caption,
            image.width,
            image.height,
            unix_now()
        ],
    )?;
    transaction.commit()?;
    Ok(replaced)
}

fn cover_ids(connection: &Connection, purpose: Purpose, owner: &Owner) -> DbResult<Vec<String>> {
    let (event_id, tribe_id) = owner_columns(owner);
    let mut statement =
        connection.prepare("SELECT id FROM images WHERE purpose = ?1 AND event_id IS ?2 AND tribe_id IS ?3")?;
    let ids = statement
        .query_map(params![purpose.as_str(), event_id, tribe_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(ids)
}

/// Removes the cover of an event or tribe and returns the removed picture ids.
pub fn remove_cover(connection: &Connection, owner: &Owner) -> DbResult<Vec<String>> {
    let purpose = match owner {
        Owner::Event(_) => Purpose::EventCover,
        Owner::Tribe(_) => Purpose::TribeCover,
    };
    let ids = cover_ids(connection, purpose, owner)?;
    let (event_id, tribe_id) = owner_columns(owner);
    connection.execute(
        "DELETE FROM images WHERE purpose = ?1 AND event_id IS ?2 AND tribe_id IS ?3",
        params![purpose.as_str(), event_id, tribe_id],
    )?;
    Ok(ids)
}

/// One picture's row.
pub fn get(connection: &Connection, image_id: &str) -> DbResult<ImageRecord> {
    let row = connection
        .query_row(
            "SELECT id, uploader_id, purpose, event_id, tribe_id FROM images WHERE id = ?1",
            [image_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or(DbError::NotFound)?;
    let (id, uploader_id, purpose, event_id, tribe_id) = row;
    let purpose = Purpose::parse(&purpose).ok_or(DbError::NotFound)?;
    let owner = match (event_id, tribe_id) {
        (Some(event_id), None) => Owner::Event(event_id),
        (None, Some(tribe_id)) => Owner::Tribe(tribe_id),
        _ => return Err(DbError::NotFound),
    };
    Ok(ImageRecord { id, uploader_id, purpose, owner })
}

/// An event's shared photos, newest first.
pub fn photos(connection: &Connection, event_id: &str) -> DbResult<Vec<Photo>> {
    let mut statement = connection.prepare(
        "SELECT i.id, i.uploader_id, COALESCE(u.name, 'Someone'), i.caption, i.width, i.height, i.created_at
         FROM images i LEFT JOIN users u ON u.id = i.uploader_id
         WHERE i.event_id = ?1 AND i.purpose = 'event_photo'
         ORDER BY i.created_at DESC, i.rowid DESC",
    )?;
    let photos = statement
        .query_map([event_id], |row| {
            Ok(Photo {
                id: row.get(0)?,
                uploader_id: row.get(1)?,
                uploader_name: row.get(2)?,
                caption: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(photos)
}

/// Deletes one picture's row.
pub fn delete(connection: &Connection, image_id: &str) -> DbResult<()> {
    connection.execute("DELETE FROM images WHERE id = ?1", [image_id])?;
    Ok(())
}

/// Every picture id still in use; files for any other id can be deleted.
pub fn all_ids(connection: &Connection) -> DbResult<HashSet<String>> {
    let mut statement = connection.prepare("SELECT id FROM images")?;
    let ids = statement
        .query_map([], |row| row.get(0))?
        .collect::<Result<HashSet<String>, _>>()?;
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{self, NewEvent};
    use crate::{schema, tribes, users};

    fn cover<'a>(id: &'a str, uploader: &'a str, owner: Owner) -> NewImage<'a> {
        let purpose = match owner {
            Owner::Event(_) => Purpose::EventCover,
            Owner::Tribe(_) => Purpose::TribeCover,
        };
        NewImage { id, uploader_id: uploader, purpose, owner, caption: "", width: 1600, height: 900 }
    }

    #[test]
    fn a_new_cover_replaces_the_old_one() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let owner = Owner::Tribe(tribe.id.clone());
        assert!(add(&mut connection, &cover("first", &ada.id, owner.clone()))?.is_empty());
        let replaced = add(&mut connection, &cover("second", &ada.id, owner.clone()))?;
        assert_eq!(replaced, vec!["first".to_string()]);
        let seen = tribes::get(&connection, &tribe.id, &ada.id)?;
        assert_eq!(seen.cover_image.as_deref(), Some("second"));
        assert_eq!(remove_cover(&connection, &owner)?, vec!["second".to_string()]);
        assert_eq!(tribes::get(&connection, &tribe.id, &ada.id)?.cover_image, None);
        Ok(())
    }

    #[test]
    fn photos_list_and_go_with_their_event() -> DbResult<()> {
        let mut connection = Connection::open_in_memory()?;
        schema::prepare(&connection)?;
        let ada = users::create(&connection, "a@example.com", "Ada", "hash")?;
        let tribe = tribes::create(&mut connection, &ada.id, "Walkers", "", "", "peak")?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &NewEvent {
                title: "Hike".to_string(),
                description: String::new(),
                place_name: "Paradise".to_string(),
                lat: 46.78,
                lng: -121.73,
                starts_at: unix_now() + 60,
                tz_offset_minutes: 0,
            },
        )?;
        let owner = Owner::Event(event.id.clone());
        for id in ["one", "two"] {
            add(
                &mut connection,
                &NewImage { id, uploader_id: &ada.id, purpose: Purpose::EventPhoto, owner: owner.clone(), caption: "Summit", width: 800, height: 600 },
            )?;
        }
        add(&mut connection, &cover("banner", &ada.id, owner.clone()))?;
        let gallery = photos(&connection, &event.id)?;
        assert_eq!(gallery.len(), 2, "the cover is not in the gallery");
        assert_eq!(gallery[0].uploader_name, "Ada");
        assert_eq!(get(&connection, "one")?.purpose, Purpose::EventPhoto);
        assert_eq!(events::get(&connection, &event.id, &ada.id)?.cover_image.as_deref(), Some("banner"));

        events::delete(&connection, &event.id)?;
        assert!(all_ids(&connection)?.is_empty());
        Ok(())
    }
}
