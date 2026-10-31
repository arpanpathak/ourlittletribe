//! The tables, created on first start.
//!
//! Times are Unix seconds. Ids are random UUID strings.

use rusqlite::Connection;

use crate::DbResult;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    home_area     TEXT NOT NULL DEFAULT '',
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tribes (
    id          TEXT PRIMARY KEY,
    creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    home_area   TEXT NOT NULL DEFAULT '',
    emblem      TEXT NOT NULL DEFAULT 'peak',
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tribe_members (
    tribe_id  TEXT NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (tribe_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    tribe_id    TEXT NOT NULL REFERENCES tribes(id) ON DELETE CASCADE,
    creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    place_name  TEXT NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    starts_at   INTEGER NOT NULL,
    tz_offset_minutes INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_start ON events(starts_at);
CREATE INDEX IF NOT EXISTS events_by_tribe ON events(tribe_id, starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL CHECK (status IN ('going', 'not_going')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS event_votes (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote     INTEGER NOT NULL CHECK (vote IN (-1, 1)),
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS prep_items (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    why        TEXT NOT NULL DEFAULT '',
    scope      TEXT NOT NULL CHECK (scope IN ('personal', 'shared')),
    quantity   INTEGER NOT NULL DEFAULT 1,
    shop_tags  TEXT NOT NULL DEFAULT '[]',
    source     TEXT NOT NULL CHECK (source IN ('model', 'person')),
    added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (event_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS item_marks (
    item_id    TEXT NOT NULL REFERENCES prep_items(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state      TEXT NOT NULL CHECK (state IN ('bringing', 'got')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS trip_origins (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS stores (
    id            TEXT PRIMARY KEY,
    osm_ref       TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    shop_tag      TEXT NOT NULL,
    lat           REAL NOT NULL,
    lng           REAL NOT NULL,
    address       TEXT NOT NULL DEFAULT '',
    opening_hours TEXT NOT NULL DEFAULT '',
    updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stores_by_position ON stores(lat, lng);

CREATE TABLE IF NOT EXISTS activity_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    summary     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_by_time ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS images (
    id          TEXT PRIMARY KEY,
    uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    purpose     TEXT NOT NULL CHECK (purpose IN ('event_cover', 'event_photo', 'tribe_cover')),
    event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
    tribe_id    TEXT REFERENCES tribes(id) ON DELETE CASCADE,
    caption     TEXT NOT NULL DEFAULT '',
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    CHECK ((event_id IS NULL) <> (tribe_id IS NULL))
);
CREATE INDEX IF NOT EXISTS images_by_event ON images(event_id, purpose, created_at);
CREATE INDEX IF NOT EXISTS images_by_tribe ON images(tribe_id, purpose, created_at);

CREATE TABLE IF NOT EXISTS event_stops (
    id        TEXT PRIMARY KEY,
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('stop', 'optional', 'venue')),
    name      TEXT NOT NULL,
    lat       REAL NOT NULL,
    lng       REAL NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    position  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stops_by_event ON event_stops(event_id, position);

CREATE TABLE IF NOT EXISTS inline_images (
    id          TEXT PRIMARY KEY,
    uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
"#;

/// Columns added after the first release, with their definitions; added to older files on start.
const ADDED_COLUMNS: [(&str, &str, &str); 2] = [
    ("users", "avatar_image", "TEXT"),
    ("users", "cover_image", "TEXT"),
];

/// Turns on foreign keys and write-ahead logging, and creates any missing table.
pub fn prepare(connection: &Connection) -> DbResult<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
    )?;
    connection.execute_batch(SCHEMA)?;
    for (table, column, definition) in ADDED_COLUMNS {
        let present: bool = connection.query_row(
            &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('{table}') WHERE name = ?1"),
            [column],
            |row| row.get(0),
        )?;
        if !present {
            connection.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    Ok(())
}
