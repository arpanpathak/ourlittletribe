//! Model-assisted place search, for what plain geocoding misses.
//!
//! A geocoder matches words against names, so "mt rainier henry jackson"
//! finds nothing: the visitor center is called "Jackson Visitor Center" and
//! "mt rainier" is where it is, not part of its name. The model reads the
//! search as people mean it and answers with guesses like "Henry M. Jackson
//! Memorial Visitor Center, in Mount Rainier National Park". Each guess is then
//! looked up for real: first the area, then the name inside the area's
//! bounds, and failing that each distinctive word of the name inside those
//! bounds. Only places OpenStreetMap actually has are returned.

use std::time::Duration;

use tokio::task::JoinSet;
use tribe_brain::PlaceGuess;
use tribe_core::geo::LatLng;
use tribe_places::photon::PlaceMatch;

use crate::state::AppState;

/// How long the model may take to read a search before plain results stand alone.
const MODEL_WAIT: Duration = Duration::from_secs(8);
/// How long the map lookups for the guesses may take in all.
const LOOKUP_WAIT: Duration = Duration::from_secs(12);
/// Results kept per guess.
const PER_GUESS: usize = 5;
/// Once the guesses have found this many places, the rest are not looked up.
const ENOUGH_CANDIDATES: usize = 6;
/// Places shown to the model to choose from.
const MOST_CANDIDATES: usize = 16;
/// Results returned in all.
const MOST_RESULTS: usize = 6;
/// Words shorter than this are too common to search on their own.
const SHORTEST_WORD: usize = 4;
/// Single-word searches made for one guess at most.
const MOST_WORD_SEARCHES: usize = 3;

/// The name of the region around `near`, such as "Seattle, Washington, United States",
/// to tell the model where the searcher is.
async fn region_name(state: &AppState, near: LatLng) -> Option<String> {
    let key = format!("{:.1},{:.1}", near.lat, near.lng);
    if let Some(name) = state.regions.get(&key) {
        return Some(name);
    }
    let found = state.places.place_at(near).await.ok().flatten()?;
    let name = match found.detail.is_empty() {
        true => found.name,
        false => found.detail,
    };
    state.regions.put(key, name.clone());
    Some(name)
}

/// Lower-case words of `text`.
fn words_of(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Words of `name` worth searching alone inside an area, in order, leaving
/// out short words and words that only repeat the area's own name.
fn distinctive_words(name: &str, area_name: &str) -> Vec<String> {
    let area_words = words_of(area_name);
    let mut words: Vec<String> = Vec::new();
    for word in words_of(name) {
        if word.chars().count() >= SHORTEST_WORD
            && !area_words.contains(&word)
            && !words.contains(&word)
        {
            words.push(word);
        }
    }
    words.truncate(MOST_WORD_SEARCHES);
    words
}

/// How many different `wanted` words a place's name contains.
fn name_overlap(place: &PlaceMatch, wanted: &[String]) -> usize {
    let have = words_of(&place.name);
    let mut matched: Vec<&String> = wanted.iter().filter(|word| have.contains(word)).collect();
    matched.sort();
    matched.dedup();
    matched.len()
}

/// Real places for one guess.
async fn look_up(
    state: &AppState,
    guess: PlaceGuess,
    typed: String,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let places = state.places.clone();
    let area = match guess.area.is_empty() {
        true => None,
        false => match state.areas.get(&guess.area.to_lowercase()) {
            Some(known) => known,
            None => match places.find_area(&guess.area, near).await {
                Ok(found) => {
                    state.areas.put(guess.area.to_lowercase(), found.clone());
                    found
                }
                Err(_) => None,
            },
        },
    };
    if let Some((area_place, _)) = &area
        && words_of(&guess.name) == words_of(&area_place.name)
    {
        return vec![area_place.clone()];
    }
    let Some((area_place, bounds)) = area else {
        let mut found = places
            .search_places(&guess.name, near, PER_GUESS as u8)
            .await
            .unwrap_or_default();
        found.truncate(PER_GUESS);
        return found;
    };
    let mut found = places
        .search_within(&guess.name, bounds, PER_GUESS as u8)
        .await
        .unwrap_or_default();
    if found.is_empty() {
        // A geocoder needs every word to match, so a longer official name than
        // the map has finds nothing. Search each word alone, then keep the
        // places whose names share the most words with the guess.
        let mut wanted = words_of(&guess.name);
        wanted.extend(words_of(&typed));
        // What the person typed comes first; the model's fuller name adds the rest.
        let mut words = distinctive_words(&typed, &format!("{} {}", area_place.name, guess.area));
        for word in distinctive_words(&guess.name, &area_place.name) {
            if !words.contains(&word) {
                words.push(word);
            }
        }
        words.truncate(MOST_WORD_SEARCHES);
        let mut searches = JoinSet::new();
        for (order, word) in words.into_iter().enumerate() {
            let places = places.clone();
            searches.spawn(async move {
                (
                    order,
                    places
                        .search_within(&word, bounds, 5)
                        .await
                        .unwrap_or_default(),
                )
            });
        }
        let mut candidates: Vec<(usize, usize, PlaceMatch)> = Vec::new();
        while let Some(joined) = searches.join_next().await {
            let Ok((order, places_found)) = joined else {
                continue;
            };
            for (rank, place) in places_found.into_iter().enumerate() {
                if !candidates
                    .iter()
                    .any(|(_, _, kept)| same_place(kept, &place))
                {
                    candidates.push((order * 10 + rank, name_overlap(&place, &wanted), place));
                }
            }
        }
        let best = candidates
            .iter()
            .map(|(_, overlap, _)| *overlap)
            .max()
            .unwrap_or(0);
        candidates.retain(|(_, overlap, _)| *overlap > 0 && *overlap + 2 >= best);
        candidates.sort_by_key(|(order, overlap, _)| (std::cmp::Reverse(*overlap), *order));
        found = candidates.into_iter().map(|(_, _, place)| place).collect();
    }
    if found.is_empty() && words_of(&guess.name) == words_of(&area_place.name) {
        found.push(area_place);
    }
    found.truncate(PER_GUESS);
    found
}

fn same_place(first: &PlaceMatch, second: &PlaceMatch) -> bool {
    first.name.eq_ignore_ascii_case(&second.name)
        && (first.lat - second.lat).abs() < 0.003
        && (first.lng - second.lng).abs() < 0.003
}

/// Places the model thinks `query` means, checked against OpenStreetMap.
/// Empty when no model is configured or it does not answer in time.
pub async fn smart_places(state: &AppState, query: &str, near: Option<LatLng>) -> Vec<PlaceMatch> {
    let Some(brain) = state.brain.clone() else {
        return Vec::new();
    };
    let key = match near {
        Some(point) => format!("{}|{:.1},{:.1}", query.to_lowercase(), point.lat, point.lng),
        None => query.to_lowercase(),
    };
    if let Some(cached) = state.place_guesses.get(&key) {
        return cached;
    }
    let plain_places = state.places.clone();
    let plain_query = query.to_string();
    let plain_search = tokio::spawn(async move {
        plain_places
            .search_places(&plain_query, near, 7)
            .await
            .unwrap_or_default()
    });
    let region = match near {
        Some(point) => region_name(state, point).await,
        None => None,
    };
    let guesses = match tokio::time::timeout(
        MODEL_WAIT,
        brain.interpret_place_search(query, region.as_deref()),
    )
    .await
    {
        Ok(Ok(guesses)) => guesses,
        Ok(Err(error)) => {
            tracing::warn!(%error, "model could not read a place search");
            return Vec::new();
        }
        Err(_) => {
            tracing::warn!("model took too long reading a place search");
            return Vec::new();
        }
    };
    tracing::debug!(?guesses, query, "place search guesses");

    // Guesses are looked up in order, most likely first, so the best one is
    // always finished even when the geocoder is slow (Nominatim answers once a second).
    let mut by_guess: Vec<Vec<PlaceMatch>> = Vec::new();
    let lookups = async {
        for guess in guesses {
            let found = look_up(state, guess, query.to_string(), near).await;
            by_guess.push(found);
            if by_guess.iter().map(Vec::len).sum::<usize>() >= ENOUGH_CANDIDATES {
                break;
            }
        }
    };
    if tokio::time::timeout(LOOKUP_WAIT, lookups).await.is_err() {
        tracing::warn!(query, "place lookups took too long; using what was found");
    }

    let plain = plain_search.await.unwrap_or_default();
    let mut candidates: Vec<PlaceMatch> = Vec::new();
    for place in by_guess.into_iter().flatten().chain(plain) {
        if !candidates.iter().any(|kept| same_place(kept, &place)) {
            candidates.push(place);
        }
    }
    candidates.truncate(MOST_CANDIDATES);
    if candidates.is_empty() {
        return candidates;
    }

    let lines: Vec<String> = candidates
        .iter()
        .map(|place| {
            format!(
                "{} ({}) — {}",
                place.name,
                if place.kind.is_empty() {
                    "place"
                } else {
                    &place.kind
                },
                place.detail
            )
        })
        .collect();
    let results = match tokio::time::timeout(
        MODEL_WAIT,
        brain.choose_places(query, region.as_deref(), &lines),
    )
    .await
    {
        Ok(Ok(chosen)) => {
            tracing::debug!(?chosen, ?lines, "place search choice");
            chosen
                .into_iter()
                .filter_map(|index| candidates.get(index).cloned())
                .take(MOST_RESULTS)
                .collect()
        }
        _ => {
            tracing::warn!(
                query,
                "model could not choose between places; returning them unranked"
            );
            candidates.truncate(MOST_RESULTS);
            candidates
        }
    };
    state.place_guesses.put(key, results.clone());
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
}
