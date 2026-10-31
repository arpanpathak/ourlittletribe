//! The facts of a trip, written out for the model, and the instructions it gets.

use std::fmt::Write;

/// Instructions for planning a whole list.
pub const PLAN_SYSTEM: &str = "You help a small group get ready for a real-world gathering. \
From the facts given, decide what the group should buy or bring. \
Ground every item in a fact: the description, the forecast, the elevation, the daylight, the drive, the group size, or the pairings earlier groups bought. \
Name the fact in `why`, with its number when there is one, in under 15 words. \
Prefer things people may not already own or may forget: food, water, consumables, safety items, passes and permits, and gear the conditions call for. \
Skip ordinary clothing unless the conditions make it a real need. \
`personal` means one per person, `shared` means one for the group. `quantity` is the total for the whole group. \
`shop_tags` lists 1 to 4 OpenStreetMap shop=* values of stores that sell the item, most likely first: only the value, as in outdoor, supermarket, convenience, chemist, pet, sports, never the word shop itself. \
Do not repeat items already on the list. At most 12 items.";

/// Instructions for answering one search.
pub const SEARCH_SYSTEM: &str = "You help one person on a group trip find what they are searching for. \
Turn the search into concrete things to buy, using the trip's facts. \
In `why`, say in under 15 words how the item answers the search on this trip. \
`personal` means one per person, `shared` means one for the group. `quantity` is the total for the whole group. \
`shop_tags` lists 1 to 4 OpenStreetMap shop=* values of stores that sell the item, most likely first: only the value, as in outdoor, supermarket, convenience, chemist, pet, sports, never the word shop itself.";

/// The forecast at the meeting point, on the day.
#[derive(Debug, Clone)]
pub struct WeatherFacts {
    /// Highest temperature, °C.
    pub max_temp_c: f64,
    /// Lowest temperature, °C.
    pub min_temp_c: f64,
    /// Chance of precipitation, percent.
    pub precipitation_chance: f64,
    /// Precipitation, mm.
    pub precipitation_mm: f64,
    /// Snowfall, cm.
    pub snowfall_cm: f64,
    /// Strongest wind, km/h.
    pub max_wind_kmh: f64,
    /// Highest UV index.
    pub max_uv_index: f64,
    /// Sunrise, local clock time.
    pub sunrise_local: String,
    /// Sunset, local clock time.
    pub sunset_local: String,
}

/// The drive of the person asking.
#[derive(Debug, Clone)]
pub struct DriveFacts {
    /// Driving time, minutes.
    pub minutes: f64,
    /// Distance, kilometres.
    pub km: f64,
}

/// Everything the model is told about one trip.
#[derive(Debug, Clone, Default)]
pub struct TripFacts {
    /// Event title.
    pub title: String,
    /// The organiser's description.
    pub description: String,
    /// The meeting place.
    pub place_name: String,
    /// Start, as local time, such as "Saturday 2026-11-07 08:00".
    pub starts_local: String,
    /// How many people are going.
    pub group_size: u32,
    /// Elevation of the meeting point, metres.
    pub elevation_m: Option<f64>,
    /// Forecast for the day, when it is within range.
    pub weather: Option<WeatherFacts>,
    /// The asking person's drive, when they shared a starting point.
    pub drive: Option<DriveFacts>,
    /// Names already on the list.
    pub already_listed: Vec<String>,
    /// Lines like "groups that got trail mix also got electrolyte drink in 6 of 6 trips".
    pub learned_pairings: Vec<String>,
}

impl TripFacts {
    /// The facts as plain lines for the model's prompt.
    pub fn describe(&self) -> String {
        let mut text = String::new();
        let _ = writeln!(text, "Event: {}", self.title);
        let _ = writeln!(text, "Meeting place: {}", self.place_name);
        let _ = writeln!(text, "Starts: {} (local time)", self.starts_local);
        let _ = writeln!(text, "People going: {}", self.group_size.max(1));
        match self.description.trim() {
            "" => {
                let _ = writeln!(text, "Description: none given");
            }
            description => {
                let _ = writeln!(text, "Description from the organiser:\n\"\"\"\n{description}\n\"\"\"");
            }
        }
        if let Some(elevation) = self.elevation_m {
            let _ = writeln!(text, "Meeting point elevation: {elevation:.0} m");
        }
        match &self.weather {
            Some(weather) => {
                let _ = writeln!(
                    text,
                    "Forecast for that day at the meeting point: high {:.0} °C, low {:.0} °C, \
                     precipitation chance {:.0}% ({:.1} mm), snowfall {:.1} cm, wind up to {:.0} km/h, UV index {:.1}, \
                     sunrise {}, sunset {}",
                    weather.max_temp_c,
                    weather.min_temp_c,
                    weather.precipitation_chance,
                    weather.precipitation_mm,
                    weather.snowfall_cm,
                    weather.max_wind_kmh,
                    weather.max_uv_index,
                    weather.sunrise_local,
                    weather.sunset_local
                );
            }
            None => {
                let _ = writeln!(text, "Forecast: not available yet; use what is typical for the place and month.");
            }
        }
        if let Some(drive) = &self.drive {
            let _ = writeln!(text, "Drive to the meeting point: {:.0} minutes, {:.0} km", drive.minutes, drive.km);
        }
        if !self.already_listed.is_empty() {
            let _ = writeln!(text, "Already on the list: {}", self.already_listed.join("; "));
        }
        if !self.learned_pairings.is_empty() {
            let _ = writeln!(text, "What earlier groups bought together:");
            for pairing in &self.learned_pairings {
                let _ = writeln!(text, "- {pairing}");
            }
        }
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_lists_the_facts_given() {
        let facts = TripFacts {
            title: "Skyline Trail".to_string(),
            description: "bring the pup".to_string(),
            place_name: "Paradise".to_string(),
            starts_local: "Saturday 2026-11-07 08:00".to_string(),
            group_size: 8,
            elevation_m: Some(1646.0),
            weather: None,
            drive: Some(DriveFacts { minutes: 125.0, km: 160.0 }),
            already_listed: vec!["Water".to_string()],
            learned_pairings: Vec::new(),
        };
        let text = facts.describe();
        assert!(text.contains("People going: 8"));
        assert!(text.contains("elevation: 1646 m"));
        assert!(text.contains("not available yet"));
        assert!(text.contains("125 minutes"));
        assert!(text.contains("Already on the list: Water"));
        assert!(!text.contains("earlier groups"));
    }
}
