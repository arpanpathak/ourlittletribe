//! Turning a geocoder's address parts into what the app shows: a short name
//! and one line saying where it is. Photon and Nominatim name their fields
//! differently, but both fill in an [`Address`].

use serde::Serialize;
use tribe_core::geo::LatLng;

/// A place found by a search or a reverse lookup.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlaceMatch {
    /// A short name for the place, such as "Paradise Inn" or "52807 Paradise Road East".
    pub name: String,
    /// Where it is, such as "Ashford, Washington, United States".
    pub detail: String,
    /// What kind of place it is, from OpenStreetMap, such as "hotel" or "peak".
    pub kind: String,
    /// Where it is; written as `lat` and `lng` in JSON.
    #[serde(flatten)]
    pub location: LatLng,
}

/// The parts of a place's address, each trimmed and present only when known.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Address {
    /// The place's own name, such as "Jackson Visitor Center".
    pub name: Option<String>,
    /// The number on the street.
    pub house_number: Option<String>,
    /// The street or road.
    pub street: Option<String>,
    /// The nearest town, district or county.
    pub town: Option<String>,
    /// The state or province.
    pub state: Option<String>,
    /// The country.
    pub country: Option<String>,
}

/// The text, trimmed, or `None` when it is missing or blank.
pub(crate) fn clean(text: Option<&str>) -> Option<String> {
    let trimmed = text?.trim();
    match trimmed.is_empty() {
        true => None,
        false => Some(trimmed.to_string()),
    }
}

impl Address {
    /// "52807 Paradise Road East", or just the street.
    fn street_line(&self) -> Option<String> {
        match (&self.house_number, &self.street) {
            (Some(number), Some(street)) => Some(format!("{number} {street}")),
            (None, Some(street)) => Some(street.clone()),
            (_, None) => None,
        }
    }

    /// What to call the place: its own name, else its street address, else its town or state.
    fn display_name(&self) -> Option<String> {
        self.name
            .clone()
            .or_else(|| self.street_line())
            .or_else(|| self.town.clone())
            .or_else(|| self.state.clone())
    }

    /// The street (when the place has its own name), town, state and country,
    /// leaving out whatever repeats the name.
    fn detail(&self, name: &str) -> String {
        let street = match self.name {
            Some(_) => self.street_line(),
            None => None,
        };

        let mut parts: Vec<String> = Vec::new();
        for part in [
            street,
            self.town.clone(),
            self.state.clone(),
            self.country.clone(),
        ]
        .into_iter()
        .flatten()
        {
            if part != name && !parts.contains(&part) {
                parts.push(part);
            }
        }
        parts.join(", ")
    }

    /// The place as the app shows it, or `None` when nothing names it.
    pub fn into_match(self, location: LatLng, osm_kind: &str) -> Option<PlaceMatch> {
        let name = self.display_name()?;
        let detail = self.detail(&name);

        Some(PlaceMatch {
            detail,
            name,
            kind: osm_kind.replace('_', " "),
            location,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARADISE: LatLng = LatLng {
        lat: 46.78,
        lng: -121.73,
    };

    fn paradise_road(name: Option<&str>) -> Address {
        Address {
            name: name.map(str::to_string),
            house_number: Some("52807".to_string()),
            street: Some("Paradise Road East".to_string()),
            town: Some("Ashford".to_string()),
            state: Some("Washington".to_string()),
            country: Some("United States".to_string()),
        }
    }

    #[test]
    fn a_named_place_keeps_its_street_in_the_detail() {
        let Some(place) = paradise_road(Some("Paradise Inn")).into_match(PARADISE, "hotel") else {
            panic!("no place");
        };
        assert_eq!(place.name, "Paradise Inn");
        assert_eq!(
            place.detail,
            "52807 Paradise Road East, Ashford, Washington, United States"
        );
        assert_eq!(place.kind, "hotel");
    }

    #[test]
    fn an_unnamed_house_is_named_by_its_street() {
        let Some(place) = paradise_road(None).into_match(PARADISE, "house") else {
            panic!("no place");
        };
        assert_eq!(place.name, "52807 Paradise Road East");
        assert_eq!(place.detail, "Ashford, Washington, United States");
    }

    #[test]
    fn a_town_is_not_repeated_in_its_own_detail() {
        let seattle = Address {
            name: Some("Seattle".to_string()),
            town: Some("Seattle".to_string()),
            state: Some("Washington".to_string()),
            ..Address::default()
        };
        let Some(place) = seattle.into_match(PARADISE, "city") else {
            panic!("no place");
        };
        assert_eq!(place.detail, "Washington");
    }

    #[test]
    fn blank_text_counts_as_missing() {
        assert_eq!(clean(Some("  ")), None);
        assert_eq!(clean(Some(" Ashford ")), Some("Ashford".to_string()));
        assert_eq!(clean(None), None);
    }
}
