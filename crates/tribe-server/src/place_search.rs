//! Model-assisted place search, for what plain geocoding misses.
//!
//! A geocoder matches words against names, so "mt rainier henry jackson"
//! finds nothing: the visitor center is called "Jackson Visitor Center", and
//! "mt rainier" is where it is, not part of its name. The model reads the
//! search the way people mean it and guesses names and areas. Each guess is
//! looked up for real: the area first, then the name inside the area's
//! bounds, then each distinctive word inside those bounds. Last, the model
//! chooses among the real places found, so it can never offer one that the
//! map does not have.

use std::time::Duration;

use tokio::task::JoinSet;
use tribe_brain::places::PlaceGuess;
use tribe_core::geo::LatLng;
use tribe_places::Places;
use tribe_places::address::PlaceMatch;
use tribe_places::photon::Area;

use crate::state::{AppState, RoughSpot, SearchKey};

/// How long the model may take to read a search.
const MODEL_WAIT: Duration = Duration::from_secs(8);

/// How long the map lookups for all guesses may take together.
const LOOKUP_WAIT: Duration = Duration::from_secs(12);

/// Places kept per guess.
const PER_GUESS: u8 = 5;

/// Once the guesses have found this many places, the rest are not looked up.
const ENOUGH_CANDIDATES: usize = 6;

/// Places shown to the model to choose from, at most.
const MOST_CANDIDATES: usize = 16;

/// Best matches returned, at most.
const MOST_RESULTS: usize = 6;

/// Words shorter than this are too common to search on their own.
const SHORTEST_WORD: usize = 4;

/// Single-word searches made for one guess, at most.
const MOST_WORD_SEARCHES: usize = 3;

/// A place found while looking up a guess, with how well its name fits.
struct Candidate {
    /// The place.
    place: PlaceMatch,
    /// How many of the wanted words its name contains.
    overlap: usize,
    /// Which search found it, then its rank there; lower is earlier.
    order: usize,
}

/// The lower-case words of `text`.
fn words_of(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Words of `name` worth searching alone inside an area: long enough, and not
/// just repeating the area's own name.
fn distinctive_words(name: &str, area_name: &str) -> Vec<String> {
    let area_words = words_of(area_name);
    let mut words: Vec<String> = Vec::new();

    for word in words_of(name) {
        let long_enough = word.chars().count() >= SHORTEST_WORD;
        if long_enough && !area_words.contains(&word) && !words.contains(&word) {
            words.push(word);
        }
    }

    words.truncate(MOST_WORD_SEARCHES);
    words
}

/// How many different wanted words a place's name contains.
fn name_overlap(place: &PlaceMatch, wanted: &[String]) -> usize {
    let have = words_of(&place.name);
    let mut matched: Vec<&String> = wanted.iter().filter(|word| have.contains(word)).collect();
    matched.sort();
    matched.dedup();
    matched.len()
}

fn same_place(first: &PlaceMatch, second: &PlaceMatch) -> bool {
    let close = (first.location.lat - second.location.lat).abs() < 0.003
        && (first.location.lng - second.location.lng).abs() < 0.003;
    close && first.name.eq_ignore_ascii_case(&second.name)
}

/// Adds `place` unless an equal one is already in `places`.
fn push_unique(places: &mut Vec<PlaceMatch>, place: PlaceMatch) {
    if !places.iter().any(|kept| same_place(kept, &place)) {
        places.push(place);
    }
}

/// The region around `near`, such as "Seattle, Washington, United States",
/// to tell the model where the person is. Cached per rough spot for a day.
pub async fn region_name(state: &AppState, near: LatLng) -> Option<String> {
    let spot = RoughSpot::of(near);
    if let Some(name) = state.caches.regions.get(&spot) {
        return Some(name);
    }

    let found = state.places.place_at(near).await.ok().flatten()?;
    let name = match found.detail.is_empty() {
        true => found.name,
        false => found.detail,
    };
    state.caches.regions.put(spot, name.clone());
    Some(name)
}

/// The area a guess names, cached by name for a day.
async fn area_for(state: &AppState, guess: &PlaceGuess, near: Option<LatLng>) -> Option<Area> {
    if guess.area.is_empty() {
        return None;
    }

    let key = guess.area.to_lowercase();
    if let Some(known) = state.caches.areas.get(&key) {
        return known;
    }

    let found = state.places.find_area(&guess.area, near).await.ok()?;
    state.caches.areas.put(key, found.clone());
    found
}

/// Searches each distinctive word inside the area, and keeps the places whose
/// names share the most words with the guess and what was typed. A geocoder
/// needs every word to match, so this finds "Jackson Visitor Center" from
/// "Henry M. Jackson Memorial Visitor Center".
async fn search_by_words(
    places: &Places,
    area: &Area,
    guess: &PlaceGuess,
    typed: &str,
) -> Vec<PlaceMatch> {
    let mut words = distinctive_words(typed, &format!("{} {}", area.place.name, guess.area));
    for word in distinctive_words(&guess.name, &area.place.name) {
        if !words.contains(&word) {
            words.push(word);
        }
    }
    words.truncate(MOST_WORD_SEARCHES);

    let mut searches = JoinSet::new();
    for (search_number, word) in words.into_iter().enumerate() {
        let places = places.clone();
        let bounds = area.bounds;
        searches.spawn(async move {
            (
                search_number,
                places
                    .search_within(&word, bounds, 5)
                    .await
                    .unwrap_or_default(),
            )
        });
    }

    let mut wanted = words_of(&guess.name);
    wanted.extend(words_of(typed));

    let mut candidates: Vec<Candidate> = Vec::new();
    while let Some(Ok((search_number, found))) = searches.join_next().await {
        for (rank, place) in found.into_iter().enumerate() {
            if candidates
                .iter()
                .any(|kept| same_place(&kept.place, &place))
            {
                continue;
            }
            let overlap = name_overlap(&place, &wanted);
            candidates.push(Candidate {
                place,
                overlap,
                order: search_number * 10 + rank,
            });
        }
    }

    let best = candidates
        .iter()
        .map(|candidate| candidate.overlap)
        .max()
        .unwrap_or(0);
    candidates.retain(|candidate| candidate.overlap > 0 && candidate.overlap + 2 >= best);
    candidates.sort_by_key(|candidate| (std::cmp::Reverse(candidate.overlap), candidate.order));
    candidates
        .into_iter()
        .map(|candidate| candidate.place)
        .collect()
}

/// Real places for one guess.
async fn look_up(
    state: &AppState,
    guess: &PlaceGuess,
    typed: &str,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let Some(area) = area_for(state, guess, near).await else {
        return state
            .places
            .search_places(&guess.name, near, PER_GUESS)
            .await
            .unwrap_or_default();
    };

    if words_of(&guess.name) == words_of(&area.place.name) {
        return vec![area.place];
    }

    let by_name = state
        .places
        .search_within(&guess.name, area.bounds, PER_GUESS)
        .await
        .unwrap_or_default();
    let mut found = match by_name.is_empty() {
        true => search_by_words(&state.places, &area, guess, typed).await,
        false => by_name,
    };

    found.truncate(usize::from(PER_GUESS));
    found
}

/// The best real place for a guess, if the map has one; used to place what the model drafted.
pub async fn resolve(
    state: &AppState,
    guess: PlaceGuess,
    near: Option<LatLng>,
) -> Option<PlaceMatch> {
    if guess.name.trim().is_empty() {
        return None;
    }
    let typed = format!("{} {}", guess.name, guess.area);
    look_up(state, &guess, &typed, near)
        .await
        .into_iter()
        .next()
}

/// Looks up the guesses in order, most likely first, until enough places are
/// found or time runs out. Going in order means the best guess always finishes,
/// even when the geocoder answers once a second.
async fn places_for_guesses(
    state: &AppState,
    guesses: &[PlaceGuess],
    typed: &str,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let mut found: Vec<PlaceMatch> = Vec::new();

    let lookups = async {
        for guess in guesses {
            for place in look_up(state, guess, typed, near).await {
                push_unique(&mut found, place);
            }
            if found.len() >= ENOUGH_CANDIDATES {
                break;
            }
        }
    };
    if tokio::time::timeout(LOOKUP_WAIT, lookups).await.is_err() {
        tracing::warn!(typed, "place lookups took too long; using what was found");
    }

    found
}

/// A candidate as one line for the model, such as "Paradise Inn (hotel) — Ashford, Washington".
fn candidate_line(place: &PlaceMatch) -> String {
    let kind = match place.kind.is_empty() {
        true => "place",
        false => place.kind.as_str(),
    };
    format!("{} ({kind}) — {}", place.name, place.detail)
}

/// The places the model thinks `typed` means, each checked against
/// OpenStreetMap. Empty when no model is configured or it does not answer.
pub async fn best_matches(state: &AppState, typed: &str, near: Option<LatLng>) -> Vec<PlaceMatch> {
    let Some(brain) = state.brain.clone() else {
        return Vec::new();
    };

    let key = SearchKey {
        text: typed.to_lowercase(),
        near: near.map(RoughSpot::of),
    };
    if let Some(cached) = state.caches.best_matches.get(&key) {
        return cached;
    }

    let plain_places = state.places.clone();
    let plain_text = typed.to_string();
    let plain_search = tokio::spawn(async move {
        plain_places
            .search_places(&plain_text, near, 7)
            .await
            .unwrap_or_default()
    });

    let region = match near {
        Some(point) => region_name(state, point).await,
        None => None,
    };
    let guesses = match tokio::time::timeout(
        MODEL_WAIT,
        brain.interpret_place_search(typed, region.as_deref()),
    )
    .await
    {
        Ok(Ok(guesses)) => guesses,
        Ok(Err(error)) => {
            tracing::warn!(%error, "the model could not read a place search");
            return Vec::new();
        }
        Err(_) => {
            tracing::warn!("the model took too long reading a place search");
            return Vec::new();
        }
    };

    let mut candidates = places_for_guesses(state, &guesses, typed, near).await;
    for place in plain_search.await.unwrap_or_default() {
        push_unique(&mut candidates, place);
    }
    candidates.truncate(MOST_CANDIDATES);
    if candidates.is_empty() {
        return candidates;
    }

    let lines: Vec<String> = candidates.iter().map(candidate_line).collect();
    let results: Vec<PlaceMatch> = match tokio::time::timeout(
        MODEL_WAIT,
        brain.choose_places(typed, region.as_deref(), &lines),
    )
    .await
    {
        Ok(Ok(chosen)) => chosen
            .into_iter()
            .filter_map(|index| candidates.get(index).cloned())
            .take(MOST_RESULTS)
            .collect(),
        _ => {
            tracing::warn!(
                typed,
                "the model could not choose between places; returning them unranked"
            );
            candidates.into_iter().take(MOST_RESULTS).collect()
        }
    };

    state.caches.best_matches.put(key, results.clone());
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinctive_words_skip_short_words_and_the_area() {
        let words = distinctive_words(
            "Henry M. Jackson Memorial Visitor Center",
            "Mount Rainier National Park",
        );
        assert_eq!(words, vec!["henry", "jackson", "memorial"]);

        let words = distinctive_words("Rainier Jackson Lodge", "Mount Rainier");
        assert_eq!(words, vec!["jackson", "lodge"]);
    }

    #[test]
    fn overlap_counts_each_word_once() {
        let place = PlaceMatch {
            name: "Jackson Visitor Center".to_string(),
            detail: String::new(),
            kind: String::new(),
            location: LatLng {
                lat: 46.78,
                lng: -121.73,
            },
        };
        let wanted = ["jackson", "visitor", "jackson", "henry"].map(str::to_string);
        assert_eq!(name_overlap(&place, &wanted), 2);
    }
}
