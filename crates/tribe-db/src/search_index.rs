//! The search index: every tribe, event and person, kept in two SQLite FTS5
//! tables by triggers.
//!
//! `search_words` splits text into words and stems them with the Porter
//! stemmer, so "replacing", "replaced" and "replace" are one word, and
//! "ai-won't-replace-us" is the words "ai", "won", "t", "replace" and "us".
//! `search_grams` indexes every three-letter piece of the text, so a word
//! with a typo still shares most of its pieces with the word it meant.

use std::collections::HashSet;

use rusqlite::types::FromSql;
use rusqlite::{Connection, params};

use crate::{DbResult, collect_rows};

/// The two index tables, and the triggers that keep them in step.
pub(crate) const SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS search_words USING fts5(
    kind UNINDEXED, id UNINDEXED, title, body,
    tokenize = 'porter unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_grams USING fts5(
    kind UNINDEXED, id UNINDEXED, text,
    tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS tribes_indexed AFTER INSERT ON tribes BEGIN
    INSERT INTO search_words (kind, id, title, body) VALUES ('tribe', new.id, new.name, new.description || ' ' || new.home_area);
    INSERT INTO search_grams (kind, id, text) VALUES ('tribe', new.id, new.name || ' ' || new.home_area);
END;
CREATE TRIGGER IF NOT EXISTS tribes_reindexed AFTER UPDATE ON tribes BEGIN
    DELETE FROM search_words WHERE kind = 'tribe' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'tribe' AND id = old.id;
    INSERT INTO search_words (kind, id, title, body) VALUES ('tribe', new.id, new.name, new.description || ' ' || new.home_area);
    INSERT INTO search_grams (kind, id, text) VALUES ('tribe', new.id, new.name || ' ' || new.home_area);
END;
CREATE TRIGGER IF NOT EXISTS tribes_unindexed AFTER DELETE ON tribes BEGIN
    DELETE FROM search_words WHERE kind = 'tribe' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'tribe' AND id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS events_indexed AFTER INSERT ON events BEGIN
    INSERT INTO search_words (kind, id, title, body) VALUES ('event', new.id, new.title, new.description || ' ' || new.place_name);
    INSERT INTO search_grams (kind, id, text) VALUES ('event', new.id, new.title || ' ' || new.place_name);
END;
CREATE TRIGGER IF NOT EXISTS events_reindexed AFTER UPDATE ON events BEGIN
    DELETE FROM search_words WHERE kind = 'event' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'event' AND id = old.id;
    INSERT INTO search_words (kind, id, title, body) VALUES ('event', new.id, new.title, new.description || ' ' || new.place_name);
    INSERT INTO search_grams (kind, id, text) VALUES ('event', new.id, new.title || ' ' || new.place_name);
END;
CREATE TRIGGER IF NOT EXISTS events_unindexed AFTER DELETE ON events BEGIN
    DELETE FROM search_words WHERE kind = 'event' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'event' AND id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS users_indexed AFTER INSERT ON users BEGIN
    INSERT INTO search_words (kind, id, title, body) VALUES ('person', new.id, new.name, new.bio || ' ' || new.home_area);
    INSERT INTO search_grams (kind, id, text) VALUES ('person', new.id, new.name || ' ' || new.home_area);
END;
CREATE TRIGGER IF NOT EXISTS users_reindexed AFTER UPDATE OF name, bio, home_area ON users BEGIN
    DELETE FROM search_words WHERE kind = 'person' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'person' AND id = old.id;
    INSERT INTO search_words (kind, id, title, body) VALUES ('person', new.id, new.name, new.bio || ' ' || new.home_area);
    INSERT INTO search_grams (kind, id, text) VALUES ('person', new.id, new.name || ' ' || new.home_area);
END;
CREATE TRIGGER IF NOT EXISTS users_unindexed AFTER DELETE ON users BEGIN
    DELETE FROM search_words WHERE kind = 'person' AND id = old.id;
    DELETE FROM search_grams WHERE kind = 'person' AND id = old.id;
END;
"#;

/// Builds both tables again from the rows; run on start, so rows written
/// before the index existed are found too.
pub(crate) fn refill(connection: &Connection) -> DbResult<()> {
    connection.execute_batch(
        "DELETE FROM search_words;
         DELETE FROM search_grams;
         INSERT INTO search_words (kind, id, title, body)
             SELECT 'tribe', id, name, description || ' ' || home_area FROM tribes;
         INSERT INTO search_words (kind, id, title, body)
             SELECT 'event', id, title, description || ' ' || place_name FROM events;
         INSERT INTO search_words (kind, id, title, body)
             SELECT 'person', id, name, bio || ' ' || home_area FROM users;
         INSERT INTO search_grams (kind, id, text) SELECT 'tribe', id, name || ' ' || home_area FROM tribes;
         INSERT INTO search_grams (kind, id, text) SELECT 'event', id, title || ' ' || place_name FROM events;
         INSERT INTO search_grams (kind, id, text) SELECT 'person', id, name || ' ' || home_area FROM users;",
    )?;
    Ok(())
}

/// What a row of the index is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A tribe.
    Tribe,
    /// An event.
    Event,
    /// A person.
    Person,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Tribe => "tribe",
            Kind::Event => "event",
            Kind::Person => "person",
        }
    }
}

/// Most ids one search returns for one kind.
const MOST_HITS: u32 = 40;

/// Shortest word worth searching for at all: a single letter, such as the
/// "t" of "won't", would match every word that starts with it.
const SHORTEST_WORD: usize = 2;

/// Shortest word worth searching for by its pieces.
const SHORTEST_GRAM_WORD: usize = 4;

/// How many of a word's three-letter pieces a row must share before it counts as a match.
const SHARED_PIECES: f64 = 0.5;

/// The words of a search: letters and digits only, lower case.
pub fn words(text: &str) -> Vec<String> {
    let pieces = text.split(|character: char| !character.is_alphanumeric());
    let present = pieces.filter(|word| !word.is_empty());

    present.map(str::to_lowercase).collect()
}

/// An FTS5 query matching any of `words` as a prefix: `"ai"* OR "replacing"*`.
fn any_word_query(words: &[String]) -> String {
    let terms: Vec<String> = words.iter().map(|word| format!("\"{word}\"*")).collect();

    terms.join(" OR ")
}

/// The three-letter pieces of a word.
fn pieces(word: &str) -> Vec<String> {
    let letters: Vec<char> = word.chars().collect();

    letters
        .windows(3)
        .map(|window| window.iter().collect())
        .collect()
}

/// Ids of `kind` whose words match any of `words`, best first. A match in
/// the title counts five times one in the body.
fn by_words<Id: FromSql>(
    connection: &Connection,
    kind: Kind,
    words: &[String],
) -> DbResult<Vec<Id>> {
    let mut statement = connection.prepare(
        "SELECT id FROM search_words
         WHERE search_words MATCH ?1 AND kind = ?2
         ORDER BY bm25(search_words, 0.0, 0.0, 5.0, 1.0) LIMIT ?3",
    )?;

    let query = any_word_query(words);
    let rows = statement.query_map(params![query, kind.as_str(), MOST_HITS], |row| row.get(0))?;

    collect_rows(rows)
}

/// A word's pieces with its ends padded, so the first and last letters
/// count too: a typo in the middle of a word then leaves most pieces intact.
fn padded_pieces(word: &str) -> HashSet<String> {
    pieces(&format!("  {word} ")).into_iter().collect()
}

/// The share of `wanted`'s pieces that `candidate` also has, from 0 to 1.
fn shared_share(wanted: &HashSet<String>, candidate: &str) -> f64 {
    let found = padded_pieces(candidate);
    let shared = wanted.intersection(&found).count();

    shared as f64 / wanted.len().max(1) as f64
}

/// Whether some word of `text` shares at least half the padded pieces of `word`.
fn close_enough(text: &str, word: &str) -> bool {
    let wanted = padded_pieces(word);
    let text_words = words(text);

    text_words
        .iter()
        .any(|candidate| shared_share(&wanted, candidate) >= SHARED_PIECES)
}

/// The quoted three-letter pieces of every long word, for an FTS5 query.
fn quoted_pieces(long_words: &[&String]) -> Vec<String> {
    let all = long_words.iter().flat_map(|word| pieces(word));

    all.map(|piece| format!("\"{piece}\"")).collect()
}

/// Ids of `kind` whose name shares most of the pieces of one of `words`:
/// this is what finds a search with a typo in it.
fn by_pieces<Id: FromSql>(
    connection: &Connection,
    kind: Kind,
    words: &[String],
) -> DbResult<Vec<Id>> {
    let long_words: Vec<&String> = words
        .iter()
        .filter(|word| word.chars().count() >= SHORTEST_GRAM_WORD)
        .collect();

    let query_pieces = quoted_pieces(&long_words);
    if query_pieces.is_empty() {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        "SELECT id, text FROM search_grams
         WHERE search_grams MATCH ?1 AND kind = ?2
         ORDER BY bm25(search_grams) LIMIT ?3",
    )?;

    let query = query_pieces.join(" OR ");
    let rows = statement.query_map(params![query, kind.as_str(), MOST_HITS], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;

    let candidates: Vec<(Id, String)> = collect_rows(rows)?;

    let close = candidates
        .into_iter()
        .filter(|(_, text)| long_words.iter().any(|word| close_enough(text, word)));
    Ok(close.map(|(id, _)| id).collect())
}

/// Ids of `kind` for the search `text`, best first: whole and stemmed words
/// first, then near spellings, each id once.
pub fn find<Id: FromSql + PartialEq>(
    connection: &Connection,
    kind: Kind,
    text: &str,
) -> DbResult<Vec<Id>> {
    let all_words = words(text);
    let words: Vec<String> = all_words
        .into_iter()
        .filter(|word| word.chars().count() >= SHORTEST_WORD)
        .collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }

    let mut found: Vec<Id> = by_words(connection, kind, &words)?;
    let near_spellings: Vec<Id> = by_pieces(connection, kind, &words)?;

    for id in near_spellings {
        if !found.contains(&id) {
            found.push(id);
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_split_on_anything_but_letters_and_digits() {
        assert_eq!(
            words("AI-won't  replace_us!"),
            vec!["ai", "won", "t", "replace", "us"]
        );
    }

    #[test]
    fn the_query_matches_any_word_as_a_prefix() {
        assert_eq!(
            any_word_query(&words("ai replacing")),
            "\"ai\"* OR \"replacing\"*"
        );
    }

    #[test]
    fn a_typo_shares_most_pieces() {
        assert!(close_enough("Jackson Visitor Center", "javkson"));
        assert!(!close_enough("Snoqualmie Falls", "javkson"));
    }
}
