//! Things at a place rather than the place itself: the parking at a trail,
//! the toilets in a park, the entrance to a building.
//!
//! Someone searching for "rattlesnake ledge parking lot" wants the car park
//! beside the trail. That car park is named after the lake, or not named at
//! all, so no search by name can find it. The model says what kind of thing
//! they want, as an OpenStreetMap tag such as `amenity=parking`, and
//! Nominatim lists the things with that tag in a small box around the place.

use tribe_core::geo::{Bounds, haversine_km};

use crate::address::PlaceMatch;
use crate::nominatim::Found;
use crate::{Places, PlacesError};

/// How far around the place to look, in degrees each way (about 1.5 km).
const FACILITY_HALF_DEGREES: f64 = 0.015;

/// Most things asked of Nominatim at once.
const MOST_ASKED: u8 = 20;

/// Most things returned.
const MOST_FACILITIES: usize = 4;

/// An OpenStreetMap tag, such as `amenity=parking`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsmTag {
    /// Such as "amenity".
    key: String,
    /// Such as "parking".
    value: String,
}

/// Whether `part` is a plain tag word: lower-case letters, digits, `_` and `:`.
/// Nothing else reaches the search.
fn plain_tag_word(part: &str) -> bool {
    let allowed = |character: char| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '_'
            || character == ':'
    };

    !part.is_empty() && part.len() <= 40 && part.chars().all(allowed)
}

impl OsmTag {
    /// The tag in `text`, such as "amenity=parking", or `None` unless both
    /// sides are plain tag words.
    pub fn parse(text: &str) -> Option<OsmTag> {
        let (key, value) = text.trim().split_once('=')?;
        if !plain_tag_word(key) || !plain_tag_word(value) {
            return None;
        }

        Some(OsmTag {
            key: key.to_string(),
            value: value.to_string(),
        })
    }

    /// The tag as a Nominatim search for every place that has it: `[amenity=parking]`.
    fn as_search(&self) -> String {
        format!("[{}={}]", self.key, self.value)
    }

    /// What to call one with no name, such as "Parking" or "Drinking water".
    pub fn plain_name(&self) -> String {
        let words = self.value.replace(['_', ':'], " ");
        let mut letters = words.chars();

        match letters.next() {
            Some(first) => first.to_uppercase().chain(letters).collect(),
            None => String::new(),
        }
    }
}

/// One thing found beside `place`, named by its own name, or as the kind of
/// thing at the place, such as "Parking at Rattlesnake Ledge Trail".
fn read_facility(found: Found, tag: &OsmTag, place: &PlaceMatch) -> (bool, PlaceMatch) {
    let name = match found.named {
        true => found.place.name,
        false => format!("{} at {}", tag.plain_name(), place.name),
    };

    let detail = match place.detail.is_empty() {
        true => format!("By {}", place.name),
        false => format!("By {} · {}", place.name, place.detail),
    };

    let facility = PlaceMatch {
        name,
        detail,
        kind: tag.value.replace('_', " "),
        location: found.place.location,
    };
    (found.named, facility)
}

/// Named ones first, then the nearest; one per name, since a car park drawn
/// in pieces, or several with no name, would all look alike.
fn best_facilities(mut found: Vec<(bool, PlaceMatch)>, place: &PlaceMatch) -> Vec<PlaceMatch> {
    let distance = |facility: &PlaceMatch| haversine_km(place.location, facility.location);
    found.sort_by(|(first_named, first), (second_named, second)| {
        second_named
            .cmp(first_named)
            .then(distance(first).total_cmp(&distance(second)))
    });

    let mut kept: Vec<PlaceMatch> = Vec::new();
    for (_, facility) in found {
        let name_shown = kept
            .iter()
            .any(|other| other.name.eq_ignore_ascii_case(&facility.name));
        if !name_shown {
            kept.push(facility);
        }
    }

    kept.truncate(MOST_FACILITIES);
    kept
}

impl Places {
    /// Things tagged `tag` beside `place`, such as its parking: named ones
    /// first, then the nearest.
    pub async fn facilities_at(
        &self,
        tag: &OsmTag,
        place: &PlaceMatch,
    ) -> Result<Vec<PlaceMatch>, PlacesError> {
        let around = Bounds::around(place.location, FACILITY_HALF_DEGREES);
        let found = self
            .nominatim_bounded(&tag.as_search(), around, MOST_ASKED)
            .await?;

        let read = found
            .into_iter()
            .map(|found| read_facility(found, tag, place))
            .collect();
        Ok(best_facilities(read, place))
    }
}

#[cfg(test)]
mod tests {
    use tribe_core::geo::LatLng;

    use super::*;

    fn at(name: &str, lat: f64) -> PlaceMatch {
        PlaceMatch {
            name: name.to_string(),
            detail: String::new(),
            kind: "parking".to_string(),
            location: LatLng { lat, lng: -121.77 },
        }
    }

    fn trail() -> PlaceMatch {
        PlaceMatch {
            detail: "King County, Washington".to_string(),
            kind: "path".to_string(),
            ..at("Rattlesnake Ledge Trail", 47.4356)
        }
    }

    #[test]
    fn only_plain_tags_are_accepted() {
        assert!(OsmTag::parse("amenity=parking").is_some());
        assert!(OsmTag::parse(" highway=trailhead ").is_some());

        assert_eq!(OsmTag::parse(""), None);
        assert_eq!(OsmTag::parse("parking"), None);
        assert_eq!(OsmTag::parse("amenity=parking] near [x"), None);
        assert_eq!(OsmTag::parse("Amenity=Parking"), None);
    }

    #[test]
    fn a_thing_without_a_name_is_named_for_the_place() {
        let Some(tag) = OsmTag::parse("amenity=drinking_water") else {
            panic!("tag not read");
        };
        assert_eq!(tag.as_search(), "[amenity=drinking_water]");
        assert_eq!(tag.plain_name(), "Drinking water");

        let found = Found {
            place: at("Southeast 79th Street", 47.43),
            outline: None,
            named: false,
        };
        let (named, facility) = read_facility(found, &tag, &trail());

        assert!(!named);
        assert_eq!(facility.name, "Drinking water at Rattlesnake Ledge Trail");
        assert_eq!(
            facility.detail,
            "By Rattlesnake Ledge Trail · King County, Washington"
        );
    }

    #[test]
    fn named_ones_come_first_then_the_nearest_once_each() {
        let found = vec![
            (false, at("Parking at Rattlesnake Ledge Trail", 47.4357)),
            (false, at("Parking at Rattlesnake Ledge Trail", 47.4300)),
            (true, at("Rattlesnake Lake Trailhead", 47.4338)),
        ];

        let names: Vec<String> = best_facilities(found, &trail())
            .into_iter()
            .map(|place| place.name)
            .collect();
        assert_eq!(
            names,
            vec![
                "Rattlesnake Lake Trailhead",
                "Parking at Rattlesnake Ledge Trail"
            ]
        );
    }
}
