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
use tribe_brain::Brain;
use tribe_brain::places::PlaceGuess;
use tribe_core::geo::{LatLng, haversine_km};
use tribe_places::Places;
use tribe_places::address::PlaceMatch;
use tribe_places::facilities::OsmTag;
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

/// The words of `text`, with "&" read as "and".
fn spoken_words(text: &str) -> Vec<String> {
    words_of(&text.replace('&', " and "))
}

/// How much of what was typed a place's name says, from 0 to 1, when every
/// word of the name is one they typed; `None` when the name has a word they
/// did not type, or is a single word.
fn name_coverage(name: &str, typed: &str) -> Option<f64> {
    let typed_words = spoken_words(typed);
    let name_words = spoken_words(name);
    if name_words.len() < 2 || typed_words.is_empty() {
        return None;
    }
    if !name_words.iter().all(|word| typed_words.contains(word)) {
        return None;
    }

    let covered = typed_words
        .iter()
        .filter(|word| name_words.contains(word))
        .count();
    Some(covered as f64 / typed_words.len() as f64)
}

/// What the search shows, in order, one per name:
///
/// 1. places whose names are made only of words that were typed, those
///    saying the most of it first, since the model sometimes prefers a
///    similar place over the one spelled out ("Green Lake Park" for "Green
///    Lake Park and Ride");
/// 2. the things the search asked for at a place, such as its parking;
/// 3. the model's choices.
///
/// One per name, because a long trail comes back as many pieces with the
/// same name.
fn ranked(
    candidates: &[PlaceMatch],
    facilities: Vec<PlaceMatch>,
    chosen: Vec<PlaceMatch>,
    typed: &str,
) -> Vec<PlaceMatch> {
    let mut spelled_out: Vec<(f64, &PlaceMatch)> = Vec::new();
    for place in candidates {
        if let Some(coverage) = name_coverage(&place.name, typed) {
            spelled_out.push((coverage, place));
        }
    }
    spelled_out.sort_by(|first, second| second.0.total_cmp(&first.0));

    let ordered = spelled_out
        .into_iter()
        .map(|(_, place)| place.clone())
        .chain(facilities)
        .chain(chosen);

    let mut results: Vec<PlaceMatch> = Vec::new();
    for place in ordered {
        let name_shown = results
            .iter()
            .any(|kept| kept.name.eq_ignore_ascii_case(&place.name));
        if !name_shown {
            results.push(place);
        }
    }

    results.truncate(MOST_RESULTS);
    results
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
/// Which way to swap "and" and "&".
#[derive(Clone, Copy)]
enum Swap {
    /// "and" becomes "&".
    AndToAmpersand,
    /// "&" becomes "and".
    AmpersandToAnd,
}

/// One word, swapped if it is the word being replaced.
fn swap_word(word: &str, swap: Swap) -> &str {
    match swap {
        Swap::AndToAmpersand if word.eq_ignore_ascii_case("and") => "&",
        Swap::AmpersandToAnd if word == "&" => "and",
        Swap::AndToAmpersand | Swap::AmpersandToAnd => word,
    }
}

/// The text with "and" written as "&", or the other way round, when it has
/// either. Map names use both ("Green Lake Park & Ride"), and a geocoder
/// needs every word to match.
pub(crate) fn other_spelling(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let has_and = words.iter().any(|word| word.eq_ignore_ascii_case("and"));
    let has_ampersand = words.contains(&"&");

    let swap = match (has_and, has_ampersand) {
        (true, _) => Swap::AndToAmpersand,
        (false, true) => Swap::AmpersandToAnd,
        (false, false) => return None,
    };

    let swapped: Vec<&str> = words.iter().map(|word| swap_word(word, swap)).collect();
    Some(swapped.join(" "))
}

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

/// Whether the person typed the area the model gave, such as "mt rainier"
/// in "mt rainier henry jackson". Words the area shares with the place's
/// own name do not count: for "Rattlesnake Lake, King County" the area
/// only repeats the name.
fn area_was_typed(guess: &PlaceGuess, typed: &str) -> bool {
    let typed_words = spoken_words(typed);
    let name_words = spoken_words(&guess.name);
    let area_words = spoken_words(&guess.area);

    area_words.iter().any(|word| {
        word.chars().count() >= SHORTEST_WORD
            && !name_words.contains(word)
            && typed_words.contains(word)
    })
}

/// Whether the guess is a town or region itself, such as "Leavenworth" in
/// "Leavenworth, Washington": then the area is the place, not a business
/// with the town in its name.
fn names_its_area(guess: &PlaceGuess) -> bool {
    let first_part = guess.area.split(',').next().unwrap_or_default();
    let name = guess.name.trim();

    !name.is_empty() && name.eq_ignore_ascii_case(first_part.trim())
}

/// Whether the area the model guessed can be believed: near the person, or
/// named in what they typed. The model sometimes puts a well-known name in
/// the wrong state ("Rattlesnake Mountain" in New York for someone in
/// Seattle).
fn believable_area(area: &Area, guess: &PlaceGuess, typed: &str, near: Option<LatLng>) -> bool {
    let Some(point) = near else {
        return true;
    };

    haversine_km(point, area.place.location) <= FARTHEST_GUESS_KM || area_was_typed(guess, typed)
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

/// The word a place must have in its name to be about the guess: the
/// longest word of the guess's name that was typed too, such as
/// "rattlesnake" for "Rattlesnake Lake Trailhead" from "rattlesnake parking
/// lot". A place that only shares "lake" or "trailhead" with the guess is
/// some other lake or trailhead. A word typed joined to another counts:
/// "green" was typed in "greenlake". When the model fixed a typo and no
/// word was typed as it is, the guess's longest word.
fn key_word(guess: &PlaceGuess, typed: &str) -> Option<String> {
    let typed_words = spoken_words(typed);
    let typed_joined = typed_words.concat();
    let guess_words = spoken_words(&guess.name);

    let was_typed = |word: &&String| {
        let joined = word.chars().count() >= SHORTEST_WORD && typed_joined.contains(word.as_str());
        typed_words.contains(word) || joined
    };
    let longest = |words: Vec<&String>| {
        words
            .into_iter()
            .max_by_key(|word| word.chars().count())
            .cloned()
    };

    let typed_too: Vec<&String> = guess_words.iter().filter(was_typed).collect();
    match typed_too.is_empty() {
        true => longest(guess_words.iter().collect()),
        false => longest(typed_too),
    }
}

/// Whether `place`'s name has `key`, the word that makes it about the
/// guess. Spaces are ignored, since people and maps join and split words
/// differently: "greenlake" is in "Green Lake Park & Ride".
fn names_key_word(place: &PlaceMatch, key: Option<&str>) -> bool {
    let Some(key) = key else {
        return true;
    };

    spoken_words(&place.name).concat().contains(key)
}

/// Whether `place` is close enough to the person to be what they meant,
/// when the search did not name the region.
fn within_reach(place: &PlaceMatch, near: Option<LatLng>) -> bool {
    match near {
        Some(point) => haversine_km(point, place.location) <= FARTHEST_GUESS_KM,
        None => true,
    }
}

/// Real places for one guess, only those whose names have `key`, the
/// guess's key word. When the person typed the area, the name inside that
/// area first; otherwise the name near the person first, which a fuzzy
/// geocoder finds best, since the area the model adds on its own is often
/// wrong.
async fn look_up(
    state: &AppState,
    guess: &PlaceGuess,
    typed: &str,
    key: Option<&str>,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let about_it = |place: &PlaceMatch| names_key_word(place, key);

    let area_first = area_was_typed(guess, typed) || names_its_area(guess);
    let order = match area_first {
        true => [LookIn::Area, LookIn::Nearby],
        false => [LookIn::Nearby, LookIn::Area],
    };

    for way in order {
        let mut found = look_in(way, state, guess, typed, near).await;
        found.retain(about_it);

        if !found.is_empty() {
            found.truncate(usize::from(PER_GUESS));
            return found;
        }
    }

    Vec::new()
}

/// Where to look for a guess.
#[derive(Clone, Copy)]
enum LookIn {
    /// Inside the area the model named.
    Area,
    /// Near the person.
    Nearby,
}

async fn look_in(
    way: LookIn,
    state: &AppState,
    guess: &PlaceGuess,
    typed: &str,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    match way {
        LookIn::Area => look_up_in_area(state, guess, typed, near).await,
        LookIn::Nearby => look_up_nearby(state, guess, near).await,
    }
}

/// Places with the guess's name near the person, none of them far away.
async fn look_up_nearby(
    state: &AppState,
    guess: &PlaceGuess,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let found = state
        .places
        .search_places(&guess.name, near, PER_GUESS)
        .await
        .unwrap_or_default();

    found
        .into_iter()
        .filter(|place| within_reach(place, near))
        .collect()
}

/// Places for a guess inside the area the model named: the whole name, or
/// when the map spells it differently, its distinctive words one at a time.
async fn look_up_in_area(
    state: &AppState,
    guess: &PlaceGuess,
    typed: &str,
    near: Option<LatLng>,
) -> Vec<PlaceMatch> {
    let area = area_for(state, guess, near).await;
    let Some(area) = area.filter(|area| believable_area(area, guess, typed, near)) else {
        return Vec::new();
    };

    if words_of(&guess.name) == words_of(&area.place.name) {
        return vec![area.place];
    }

    let by_name = state
        .places
        .search_within(&guess.name, area.bounds, PER_GUESS)
        .await
        .unwrap_or_default();
    match by_name.is_empty() {
        true => search_by_words(&state.places, &area, guess, typed).await,
        false => by_name,
    }
}

/// Farthest a guessed place may be from the person, km, unless the search
/// names its region. A name alone can match a town of the same name on
/// another continent ("Renton" in Scotland).
const FARTHEST_GUESS_KM: f64 = 250.0;

/// The best real place for a guess, if the map has one; used to place what
/// the model drafted from `said`, the person's own words. A guess for a kind
/// of place, such as a café in a town, becomes a real one of that kind there.
pub async fn resolve(
    state: &AppState,
    guess: PlaceGuess,
    said: &str,
    near: Option<LatLng>,
) -> Option<PlaceMatch> {
    if guess.name.trim().is_empty() {
        return None;
    }

    if let Some(tag) = OsmTag::parse(&guess.facility) {
        return facility_in(state, &guess, &tag, near).await;
    }

    // The key word comes from what the person said, not from the model's
    // longer name for it ("Green Lake Park and Ride Transit Center").
    let typed = format!("{} {}", guess.name, guess.area);
    let key = key_word(&guess, said);
    let mut candidates = look_up(state, &guess, &typed, key.as_deref(), near).await;

    // The model's area can be wrong ("Sammamish" for Rattlesnake Ledge), so
    // the name alone is searched near the person too, in both spellings.
    let name = guess.name.trim().to_string();
    let texts = [typed.clone(), name];
    let spellings: Vec<String> = texts
        .iter()
        .flat_map(|text| std::iter::once(text.clone()).chain(other_spelling(text)))
        .collect();
    for spelling in spellings {
        let plain = state
            .places
            .search_places(&spelling, near, 5)
            .await
            .unwrap_or_default();
        for place in plain {
            push_unique(&mut candidates, place);
        }
    }
    if let Some(point) = near {
        candidates.retain(|place| haversine_km(point, place.location) <= FARTHEST_GUESS_KM);
    }
    candidates.truncate(MOST_CANDIDATES);

    choose_one(state, &typed, candidates).await
}

/// A real place of a kind in a town, such as a restaurant in Leavenworth,
/// for a plan that names only the kind; nothing when the map has none
/// there, and the person picks.
async fn facility_in(
    state: &AppState,
    guess: &PlaceGuess,
    tag: &OsmTag,
    near: Option<LatLng>,
) -> Option<PlaceMatch> {
    // "Leavenworth, Leavenworth" would match Leavenworth in Leavenworth
    // County, Kansas, so an area that only repeats the name is left out.
    let area = guess.area.trim();
    let town = match area.is_empty() || names_its_area(guess) {
        true => guess.name.clone(),
        false => format!("{}, {area}", guess.name),
    };

    let found = state.places.find_town(&town, near).await.ok()??;
    tracing::debug!(
        town,
        found = found.detail,
        "found the town for a kind of place"
    );

    facilities_at(state, tag, &found).await.into_iter().next()
}

/// The candidate the model says `typed` means. When the model says none of
/// them is right, nothing: the form then asks the person to pick the place,
/// which beats a pin in the wrong town. Without a model, or when it fails,
/// the geocoder's first answer.
async fn choose_one(
    state: &AppState,
    typed: &str,
    candidates: Vec<PlaceMatch>,
) -> Option<PlaceMatch> {
    let (Some(brain), [_, _, ..]) = (state.brain.clone(), candidates.as_slice()) else {
        return candidates.into_iter().next();
    };

    let lines: Vec<String> = candidates.iter().map(candidate_line).collect();
    tracing::debug!(typed, ?lines, "candidates for a place search");
    let chosen = tokio::time::timeout(MODEL_WAIT, brain.choose_places(typed, None, &lines)).await;

    match chosen {
        Ok(Ok(indexes)) => indexes
            .into_iter()
            .next()
            .and_then(|index| candidates.into_iter().nth(index)),
        _ => candidates.into_iter().next(),
    }
}

/// What the guesses found on the map.
#[derive(Default)]
struct GuessedPlaces {
    /// The things wanted at a place, such as its parking, when the search asked for them.
    facilities: Vec<PlaceMatch>,
    /// The places themselves, each with the reading that found it.
    places: Vec<Lead>,
}

/// A real place that may be what was meant, and what search found it, such
/// as "Henry Jackson in Mount Rainier National Park". A map's address does
/// not always say that a visitor center is in a national park; the search
/// that found it does, and the model choosing needs to know.
struct Lead {
    /// The place.
    place: PlaceMatch,
    /// The search that found it.
    found_by: String,
}

impl Lead {
    /// A place found for one of the model's guesses.
    fn for_guess(place: PlaceMatch, guess: &PlaceGuess) -> Lead {
        let found_by = match guess.area.is_empty() {
            true => guess.name.clone(),
            false => format!("{} in {}", guess.name, guess.area),
        };
        Lead { place, found_by }
    }

    /// A place found by searching for the words as typed.
    fn as_typed(place: PlaceMatch) -> Lead {
        Lead {
            place,
            found_by: "the words as typed".to_string(),
        }
    }

    /// The lead as one line for the model, such as "Jackson Visitor Center
    /// (office) — Paradise, Washington; found looking for Henry Jackson in
    /// Mount Rainier National Park".
    fn line(&self) -> String {
        format!(
            "{}; found looking for {}",
            candidate_line(&self.place),
            self.found_by
        )
    }
}

/// Adds `lead` unless its place is already in `leads`.
fn push_lead(leads: &mut Vec<Lead>, lead: Lead) {
    if !leads
        .iter()
        .any(|kept| same_place(&kept.place, &lead.place))
    {
        leads.push(lead);
    }
}

/// The thing the search asks for at a place, such as `amenity=parking`:
/// the first one the model gave that is a real tag.
fn wanted_facility(guesses: &[PlaceGuess]) -> Option<OsmTag> {
    guesses
        .iter()
        .find_map(|guess| OsmTag::parse(&guess.facility))
}

/// Looks up the guesses in order, most likely first, until enough places are
/// found or time runs out. Going in order means the best guess always
/// finishes, even when the geocoder answers once a second. When the search
/// wants a thing at its place, such as the parking, that is looked up beside
/// the first place found.
async fn places_for_guesses(
    state: &AppState,
    guesses: &[PlaceGuess],
    typed: &str,
    near: Option<LatLng>,
) -> GuessedPlaces {
    let mut found = GuessedPlaces::default();
    let facility = wanted_facility(guesses);

    let lookups = async {
        for guess in guesses {
            let started = std::time::Instant::now();
            let key = key_word(guess, typed);
            let places = look_up(state, guess, typed, key.as_deref(), near).await;
            tracing::debug!(guess = guess.name, found = places.len(), took = ?started.elapsed(), "looked up a guess");

            for place in places {
                push_lead(&mut found.places, Lead::for_guess(place, guess));
            }
            if found.places.len() >= ENOUGH_CANDIDATES {
                break;
            }
        }

        if let (Some(tag), Some(first)) = (&facility, found.places.first()) {
            found.facilities = facilities_at(state, tag, &first.place).await;
        }
    };
    if tokio::time::timeout(LOOKUP_WAIT, lookups).await.is_err() {
        tracing::warn!(typed, "place lookups took too long; using what was found");
    }

    found
}

/// The things tagged `tag` beside `place`; none when the lookup fails.
async fn facilities_at(state: &AppState, tag: &OsmTag, place: &PlaceMatch) -> Vec<PlaceMatch> {
    match state.places.facilities_at(tag, place).await {
        Ok(found) => found,
        Err(error) => {
            tracing::warn!(%error, ?tag, place = place.name, "could not look up things at a place");
            Vec::new()
        }
    }
}

/// A candidate as one line for the model, such as "Paradise Inn (hotel) — Ashford, Washington".
fn candidate_line(place: &PlaceMatch) -> String {
    let kind = match place.kind.is_empty() {
        true => "place",
        false => place.kind.as_str(),
    };
    format!("{} ({kind}) — {}", place.name, place.detail)
}

/// The region around `near`, and what the model thinks `typed` means there;
/// no guesses when the model fails or takes too long.
async fn read_search(
    state: &AppState,
    brain: &Brain,
    typed: &str,
    near: Option<LatLng>,
) -> (Option<String>, Option<Vec<PlaceGuess>>) {
    let region = match near {
        Some(point) => region_name(state, point).await,
        None => None,
    };

    let reading = brain.interpret_place_search(typed, region.as_deref());
    let guesses = match tokio::time::timeout(MODEL_WAIT, reading).await {
        Ok(Ok(guesses)) => Some(guesses),
        Ok(Err(error)) => {
            tracing::warn!(%error, "the model could not read a place search");
            None
        }
        Err(_) => {
            tracing::warn!("the model took too long reading a place search");
            None
        }
    };

    (region, guesses)
}

/// The candidates the model says `typed` means, best first. When the model
/// fails, all of them in the order found.
async fn choose_many(
    brain: &Brain,
    typed: &str,
    region: Option<&str>,
    leads: &[Lead],
) -> Vec<PlaceMatch> {
    if leads.is_empty() {
        return Vec::new();
    }

    let candidates: Vec<PlaceMatch> = leads.iter().map(|lead| lead.place.clone()).collect();
    let lines: Vec<String> = leads.iter().map(Lead::line).collect();
    tracing::debug!(typed, ?lines, "candidates for a place search");

    let choosing = brain.choose_places(typed, region, &lines);
    match tokio::time::timeout(MODEL_WAIT, choosing).await {
        Ok(Ok(chosen)) => chosen
            .into_iter()
            .filter_map(|index| candidates.get(index).cloned())
            .collect(),
        _ => {
            tracing::warn!(
                typed,
                "the model could not choose between places; returning them unranked"
            );
            candidates
        }
    }
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

    // Both run in this request, not in a spawned task, so a search the
    // person has typed past is dropped whole when the page cancels it, and
    // stops holding the map and the model.
    let plain_search = async {
        state
            .places
            .search_places(typed, near, 7)
            .await
            .unwrap_or_default()
    };
    let reading = read_search(state, &brain, typed, near);
    let (plain, (region, guesses)) = tokio::join!(plain_search, reading);
    let Some(guesses) = guesses else {
        return Vec::new();
    };

    tracing::debug!(typed, ?guesses, plain = plain.len(), "read a place search");
    let found = places_for_guesses(state, &guesses, typed, near).await;
    let mut leads = found.places;
    for place in plain {
        push_lead(&mut leads, Lead::as_typed(place));
    }
    leads.truncate(MOST_CANDIDATES);

    let chosen = choose_many(&brain, typed, region.as_deref(), &leads).await;
    let candidates: Vec<PlaceMatch> = leads.into_iter().map(|lead| lead.place).collect();
    let results = ranked(&candidates, found.facilities, chosen, typed);

    // Nothing found may be a map server that was down for a moment.
    if !results.is_empty() {
        state.caches.best_matches.put(key, results.clone());
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(name: &str) -> PlaceMatch {
        PlaceMatch {
            name: name.to_string(),
            detail: String::new(),
            kind: String::new(),
            location: LatLng {
                lat: 47.6,
                lng: -122.3,
            },
        }
    }

    #[test]
    fn a_place_spelled_out_comes_before_the_models_choice() {
        let candidates = vec![place("Green Lake Park"), place("Green Lake Park & Ride")];
        let chosen = vec![place("Green Lake Park")];

        let parking = vec![place("Parking at Green Lake Park")];
        let names: Vec<String> = ranked(&candidates, parking, chosen, "green lake park and ride")
            .into_iter()
            .map(|place| place.name)
            .collect();

        assert_eq!(
            names,
            vec![
                "Green Lake Park & Ride",
                "Green Lake Park",
                "Parking at Green Lake Park"
            ]
        );
        assert_eq!(
            name_coverage("Rattlesnake Lake Trailhead", "rattlesnake mountain trail"),
            None
        );
    }

    fn guess(name: &str) -> PlaceGuess {
        PlaceGuess {
            name: name.to_string(),
            area: String::new(),
            facility: String::new(),
        }
    }

    #[test]
    fn a_result_must_name_the_guess_not_just_its_kind() {
        let key = key_word(
            &guess("Rattlesnake Lake Trailhead"),
            "rattlesnake parking lot",
        );
        assert_eq!(key.as_deref(), Some("rattlesnake"));

        assert!(names_key_word(
            &place("Rattlesnake Lake Trailhead"),
            key.as_deref()
        ));
        assert!(!names_key_word(
            &place("Mirror Lake Trailhead"),
            key.as_deref()
        ));
        assert!(!names_key_word(
            &place("Lake Youngs Trailhead"),
            key.as_deref()
        ));

        let key = key_word(&guess("Greenlake Park and Ride"), "greenlake park and ride");
        assert!(names_key_word(
            &place("Green Lake Park & Ride"),
            key.as_deref()
        ));
    }

    #[test]
    fn a_word_typed_joined_to_another_still_counts() {
        let key = key_word(
            &guess("Green Lake Park and Ride Transit Center"),
            "meet at greenlake park and ride",
        );
        assert_eq!(key.as_deref(), Some("green"));
        assert!(names_key_word(
            &place("Green Lake Park & Ride"),
            key.as_deref()
        ));
    }

    #[test]
    fn a_typo_the_model_fixed_still_has_a_key_word() {
        let key = key_word(
            &guess("Henry M. Jackson Memorial Visitor Center"),
            "mt rainier henry jackson",
        );
        assert_eq!(key.as_deref(), Some("jackson"));

        let key = key_word(&guess("Rattlesnake Ledge"), "ratlesnake ledg");
        assert_eq!(key.as_deref(), Some("rattlesnake"));
    }

    #[test]
    fn an_area_that_repeats_the_name_was_not_typed() {
        let lake = PlaceGuess {
            name: "Rattlesnake Lake".to_string(),
            area: "Rattlesnake Lake, King County, Washington".to_string(),
            facility: String::new(),
        };
        assert!(!area_was_typed(&lake, "rattlesnake parking lot"));

        let center = PlaceGuess {
            name: "Henry M. Jackson Memorial Visitor Center".to_string(),
            area: "Mount Rainier National Park".to_string(),
            facility: String::new(),
        };
        assert!(area_was_typed(&center, "mt rainier henry jackson"));
    }

    #[test]
    fn and_and_ampersand_swap() {
        assert_eq!(
            other_spelling("green lake park and ride").as_deref(),
            Some("green lake park & ride")
        );
        assert_eq!(
            other_spelling("Park & Ride Issaquah").as_deref(),
            Some("Park and Ride Issaquah")
        );
        assert_eq!(other_spelling("rattlesnake ledge"), None);
        assert_eq!(other_spelling("sandy point"), None);
    }

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
