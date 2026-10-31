//! SQLite storage for OurLittleTribe.
//!
//! One file holds everything. Each module groups the queries for one table
//! family and takes a plain `&Connection`, so it can be tested on an
//! in-memory database. [`Db`] is the handle the server shares between
//! requests; it runs each query on Tokio's blocking pool.

pub mod activity_log;
pub mod events;
pub mod ids;
pub mod images;
pub mod kinds;
pub mod maintenance;
pub mod prep;
pub mod schema;
pub mod search;
pub mod sessions;
pub mod stops;
pub mod stores;
pub mod tribes;
pub mod users;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use rusqlite;

/// Everything that can go wrong in storage.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// SQLite reported an error.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// The row asked for does not exist.
    #[error("not found")]
    NotFound,
    /// The write would break a uniqueness rule, such as a second account for one email.
    #[error("already exists")]
    AlreadyExists,
    /// A previous query panicked while holding the connection.
    #[error("database connection poisoned")]
    Poisoned,
    /// The blocking task running a query was cancelled.
    #[error("database task failed: {0}")]
    Task(#[from] tokio::task::JoinError),
}

/// Shorthand for results from this crate.
pub type DbResult<T> = Result<T, DbError>;

/// Seconds since the Unix epoch, now.
pub fn unix_now() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_secs() as i64,
        Err(_) => 0,
    }
}

/// Collects the rows of a query, stopping at the first that fails to read.
pub(crate) fn collect_rows<T>(rows: impl Iterator<Item = rusqlite::Result<T>>) -> DbResult<Vec<T>> {
    let collected = rows.collect::<Result<Vec<T>, rusqlite::Error>>()?;
    Ok(collected)
}

/// Maps SQLite's uniqueness failure to [`DbError::AlreadyExists`] and leaves other errors as they are.
pub(crate) fn unique_violation_as_exists(error: rusqlite::Error) -> DbError {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            DbError::AlreadyExists
        }
        _ => DbError::Sqlite(error),
    }
}

/// A shared handle to the database file.
#[derive(Clone)]
pub struct Db {
    connection: Arc<Mutex<Connection>>,
}

impl Db {
    /// Opens (or creates) the database at `path` and brings its schema up to date.
    pub fn open(path: &Path) -> DbResult<Db> {
        let connection = Connection::open(path)?;
        Db::from_connection(connection)
    }

    /// Opens a private in-memory database; used by tests.
    pub fn open_in_memory() -> DbResult<Db> {
        let connection = Connection::open_in_memory()?;
        Db::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> DbResult<Db> {
        schema::prepare(&connection)?;
        Ok(Db {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    /// Runs `query` with the connection on the blocking pool and returns its result.
    pub async fn call<T, F>(&self, query: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> DbResult<T> + Send + 'static,
    {
        let connection = Arc::clone(&self.connection);
        tokio::task::spawn_blocking(move || {
            let mut guard = connection.lock().map_err(|_| DbError::Poisoned)?;
            query(&mut guard)
        })
        .await?
    }
}
