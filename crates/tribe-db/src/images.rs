//! Pictures people upload: covers for events and tribes, photos from events,
//! and pictures placed in descriptions.
//!
//! The files live on disk (see `tribe-media`); these rows say what each
//! picture belongs to. A cover is the newest cover row of its event or tribe.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::ids::{EventId, ImageId, TribeId, UserId};
use crate::{DbError, DbResult, collect_rows, unix_now};

/// The event or tribe whose banner a cover is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoverOf {
    /// An event's banner.
    Event(EventId),
    /// A tribe's banner.
    Tribe(TribeId),
}

/// What a picture is attached to, and as what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attachment {
    /// The banner of an event or a tribe.
    Cover(CoverOf),
    /// A photo someone shared from an event.
    EventPhoto {
        /// The event.
        event_id: EventId,
        /// A line about the photo.
        caption: String,
    },
}

/// A picture to record, once its files are written.
#[derive(Debug, Clone)]
pub struct NewImage {
    /// Picture id; also the name of its files.
    pub id: ImageId,
    /// Who uploaded it.
    pub uploader_id: UserId,
    /// What it is attached to.
    pub attachment: Attachment,
    /// Width of the large copy, pixels.
    pub width: u32,
    /// Height of the large copy, pixels.
    pub height: u32,
}

/// A stored picture's row.
#[derive(Debug, Clone)]
pub struct ImageRecord {
    /// Picture id.
    pub id: ImageId,
    /// Who uploaded it; empty once their account is deleted.
    pub uploader_id: Option<UserId>,
    /// What it is attached to.
    pub attachment: Attachment,
}

/// A photo shared from an event, for its gallery.
#[derive(Debug, Clone, Serialize)]
pub struct Photo {
    /// Picture id.
    pub id: ImageId,
    /// Who shared it.
    pub uploader_id: Option<UserId>,
    /// Their name, or "Someone" once their account is deleted.
    pub uploader_name: String,
    /// Their profile picture.
    pub uploader_avatar: Option<ImageId>,
    /// A line about it.
    pub caption: String,
    /// Width of the large copy, pixels.
    pub width: u32,
    /// Height of the large copy, pixels.
    pub height: u32,
    /// When it was shared, Unix seconds.
    pub created_at: i64,
}

/// The columns a picture's attachment is stored in.
struct AttachmentColumns<'a> {
    purpose: &'static str,
    event_id: Option<&'a EventId>,
    tribe_id: Option<&'a TribeId>,
    caption: &'a str,
}

fn cover_columns(cover: &CoverOf) -> AttachmentColumns<'_> {
    match cover {
        CoverOf::Event(event_id) => AttachmentColumns {
            purpose: "event_cover",
            event_id: Some(event_id),
            tribe_id: None,
            caption: "",
        },
        CoverOf::Tribe(tribe_id) => AttachmentColumns {
            purpose: "tribe_cover",
            event_id: None,
            tribe_id: Some(tribe_id),
            caption: "",
        },
    }
}

fn attachment_columns(attachment: &Attachment) -> AttachmentColumns<'_> {
    match attachment {
        Attachment::Cover(cover) => cover_columns(cover),
        Attachment::EventPhoto { event_id, caption } => AttachmentColumns {
            purpose: "event_photo",
            event_id: Some(event_id),
            tribe_id: None,
            caption,
        },
    }
}

fn read_attachment(
    purpose: &str,
    event_id: Option<EventId>,
    tribe_id: Option<TribeId>,
    caption: String,
) -> Option<Attachment> {
    match (purpose, event_id, tribe_id) {
        ("event_cover", Some(event_id), None) => Some(Attachment::Cover(CoverOf::Event(event_id))),
        ("tribe_cover", None, Some(tribe_id)) => Some(Attachment::Cover(CoverOf::Tribe(tribe_id))),
        ("event_photo", Some(event_id), None) => Some(Attachment::EventPhoto { event_id, caption }),
        _ => None,
    }
}

/// The pictures that are currently the cover of `cover`.
fn cover_ids(connection: &Connection, cover: &CoverOf) -> DbResult<Vec<ImageId>> {
    let columns = cover_columns(cover);
    let mut statement = connection.prepare(
        "SELECT id FROM images WHERE purpose = ?1 AND event_id IS ?2 AND tribe_id IS ?3",
    )?;
    collect_rows(statement.query_map(
        params![columns.purpose, columns.event_id, columns.tribe_id],
        |row| row.get(0),
    )?)
}

/// Deletes the cover rows of `cover` and returns their ids.
fn take_cover(connection: &Connection, cover: &CoverOf) -> DbResult<Vec<ImageId>> {
    let replaced = cover_ids(connection, cover)?;

    let columns = cover_columns(cover);
    connection.execute(
        "DELETE FROM images WHERE purpose = ?1 AND event_id IS ?2 AND tribe_id IS ?3",
        params![columns.purpose, columns.event_id, columns.tribe_id],
    )?;
    Ok(replaced)
}

/// Records a picture. A new cover replaces the old one; the ids of replaced
/// pictures are returned so the caller can delete their files.
pub fn add(connection: &mut Connection, image: &NewImage) -> DbResult<Vec<ImageId>> {
    let transaction = connection.transaction()?;

    let replaced = match &image.attachment {
        Attachment::Cover(cover) => take_cover(&transaction, cover)?,
        Attachment::EventPhoto { .. } => Vec::new(),
    };

    let columns = attachment_columns(&image.attachment);
    transaction.execute(
        "INSERT INTO images (id, uploader_id, purpose, event_id, tribe_id, caption, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            image.id,
            image.uploader_id,
            columns.purpose,
            columns.event_id,
            columns.tribe_id,
            columns.caption,
            image.width,
            image.height,
            unix_now()
        ],
    )?;

    transaction.commit()?;
    Ok(replaced)
}

/// Removes the cover of an event or tribe; returns the removed pictures' ids.
pub fn remove_cover(connection: &Connection, cover: &CoverOf) -> DbResult<Vec<ImageId>> {
    take_cover(connection, cover)
}

/// A picture's row as stored, before its attachment is checked.
struct ImageRow {
    id: ImageId,
    uploader_id: Option<UserId>,
    purpose: String,
    event_id: Option<EventId>,
    tribe_id: Option<TribeId>,
    caption: String,
}

fn read_image_row(row: &Row<'_>) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow {
        id: row.get(0)?,
        uploader_id: row.get(1)?,
        purpose: row.get(2)?,
        event_id: row.get(3)?,
        tribe_id: row.get(4)?,
        caption: row.get(5)?,
    })
}

/// One picture's row.
pub fn get(connection: &Connection, image_id: &ImageId) -> DbResult<ImageRecord> {
    let stored = connection
        .query_row("SELECT id, uploader_id, purpose, event_id, tribe_id, caption FROM images WHERE id = ?1", [image_id], read_image_row)
        .optional()?
        .ok_or(DbError::NotFound)?;

    let Some(attachment) = read_attachment(
        &stored.purpose,
        stored.event_id,
        stored.tribe_id,
        stored.caption,
    ) else {
        return Err(DbError::NotFound);
    };
    Ok(ImageRecord {
        id: stored.id,
        uploader_id: stored.uploader_id,
        attachment,
    })
}

fn read_photo(row: &Row<'_>) -> rusqlite::Result<Photo> {
    Ok(Photo {
        id: row.get(0)?,
        uploader_id: row.get(1)?,
        uploader_name: row.get(2)?,
        caption: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
        created_at: row.get(6)?,
        uploader_avatar: row.get(7)?,
    })
}

/// An event's shared photos, newest first.
pub fn photos(connection: &Connection, event_id: &EventId) -> DbResult<Vec<Photo>> {
    let mut statement = connection.prepare(
        "SELECT i.id, i.uploader_id, COALESCE(u.name, 'Someone'), i.caption, i.width, i.height, i.created_at, u.avatar_image
         FROM images i LEFT JOIN users u ON u.id = i.uploader_id
         WHERE i.event_id = ?1 AND i.purpose = 'event_photo'
         ORDER BY i.created_at DESC, i.rowid DESC",
    )?;
    collect_rows(statement.query_map([event_id], read_photo)?)
}

/// Deletes one picture's row.
pub fn delete(connection: &Connection, image_id: &ImageId) -> DbResult<()> {
    connection.execute("DELETE FROM images WHERE id = ?1", [image_id])?;
    Ok(())
}

/// Records a picture placed inside written text, such as an event description.
pub fn add_inline(
    connection: &Connection,
    image_id: &ImageId,
    uploader_id: &UserId,
) -> DbResult<()> {
    connection.execute(
        "INSERT INTO inline_images (id, uploader_id, created_at) VALUES (?1, ?2, ?3)",
        params![image_id, uploader_id, unix_now()],
    )?;
    Ok(())
}

/// Every picture still in use anywhere; files of any other id can be deleted.
pub fn all_ids(connection: &Connection) -> DbResult<HashSet<ImageId>> {
    let mut statement = connection.prepare(
        "SELECT id FROM images
         UNION SELECT id FROM inline_images
         UNION SELECT avatar_image FROM users WHERE avatar_image IS NOT NULL
         UNION SELECT cover_image FROM users WHERE cover_image IS NOT NULL",
    )?;
    let ids = collect_rows(statement.query_map([], |row| row.get(0))?)?;
    Ok(ids.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events;
    use crate::events::tests::{ada_and_her_tribe, skyline_trail};

    fn picture(uploader_id: &UserId, attachment: Attachment) -> NewImage {
        NewImage {
            id: ImageId::random(),
            uploader_id: uploader_id.clone(),
            attachment,
            width: 1600,
            height: 900,
        }
    }

    #[test]
    fn a_new_cover_replaces_the_old_one() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let banner = Attachment::Cover(CoverOf::Tribe(tribe.id.clone()));
        let first = picture(&ada.id, banner.clone());
        let second = picture(&ada.id, banner);

        assert!(add(&mut connection, &first)?.is_empty());
        assert_eq!(add(&mut connection, &second)?, vec![first.id.clone()]);

        let removed = remove_cover(&connection, &CoverOf::Tribe(tribe.id.clone()))?;
        assert_eq!(removed, vec![second.id]);
        assert!(all_ids(&connection)?.is_empty());
        Ok(())
    }

    #[test]
    fn photos_list_newest_first_and_records_read_back() -> DbResult<()> {
        let (mut connection, ada, tribe) = ada_and_her_tribe()?;
        let event = events::create(
            &mut connection,
            &tribe.id,
            &ada.id,
            &skyline_trail(unix_now() + 60),
        )?;
        let photo_of = |caption: &str| Attachment::EventPhoto {
            event_id: event.id.clone(),
            caption: caption.to_string(),
        };

        let morning = picture(&ada.id, photo_of("Morning"));
        let summit = picture(&ada.id, photo_of("Summit"));
        add(&mut connection, &morning)?;
        add(&mut connection, &summit)?;

        let captions: Vec<String> = photos(&connection, &event.id)?
            .into_iter()
            .map(|photo| photo.caption)
            .collect();
        assert_eq!(captions, vec!["Summit".to_string(), "Morning".to_string()]);
        assert_eq!(get(&connection, &summit.id)?.attachment, photo_of("Summit"));

        events::delete(&connection, &event.id)?;
        assert!(photos(&connection, &event.id)?.is_empty());
        Ok(())
    }
}
