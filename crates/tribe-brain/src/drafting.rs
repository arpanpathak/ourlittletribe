//! Writing for people: filling in an event or a tribe from what someone
//! said, and writing or rewriting a description.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tribe_core::itinerary::StopKind;

use crate::client::{AnswerStyle, Brain, Question};
use crate::places::{PlaceGuess, guess_schema};
use crate::{BrainError, clip, prompt};

/// Most places besides the meeting point a draft may have.
const MAX_STOPS: usize = 14;

/// Longest drafted description kept, in characters.
const LONGEST_DESCRIPTION: usize = 8000;

/// An event form filled in from someone's own words.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventDraft {
    /// Short title.
    pub title: String,
    /// The day, as `YYYY-MM-DD`, when they said one.
    pub date: Option<String>,
    /// The start time, as 24-hour `HH:MM`, when they said one.
    pub time: Option<String>,
    /// Where people gather first, when they said.
    pub meeting_point: Option<PlaceGuess>,
    /// Other places, in itinerary order; at most one venue.
    pub stops: Vec<DraftStop>,
    /// The person's tribe the event belongs in, by name, when one fits.
    pub tribe: Option<String>,
}

/// One more place in a drafted event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DraftStop {
    /// What it is for.
    pub kind: StopKind,
    /// The place, as a name and an area to look up.
    pub place: PlaceGuess,
    /// A few words about it from what they said.
    pub note: String,
}

/// A place in the model's draft, with a few words about it.
#[derive(Deserialize)]
struct RawPlace {
    name: String,
    area: String,
    facility: String,
    note: String,
}

/// A place on the way in the model's draft; `optional` when only some stop there.
#[derive(Deserialize)]
struct RawWayStop {
    name: String,
    area: String,
    facility: String,
    note: String,
    optional: bool,
}

impl RawPlace {
    fn guess(self) -> (PlaceGuess, String) {
        let guess = PlaceGuess {
            name: self.name,
            area: self.area,
            facility: self.facility,
        };
        (guess, self.note)
    }
}

impl RawWayStop {
    fn guess(self) -> (PlaceGuess, String, bool) {
        let guess = PlaceGuess {
            name: self.name,
            area: self.area,
            facility: self.facility,
        };
        (guess, self.note, self.optional)
    }
}

/// The draft as the model writes it, before checking.
///
/// Each kind of place has a field of its own. With one list of places and a
/// kind on each, the model left the list empty even when the plan named six
/// towns and a lunch. The description is not here: it is written afterwards,
/// from the real places found for these.
#[derive(Deserialize)]
struct RawDraft {
    title: String,
    tribe: String,
    date: String,
    time: String,
    meeting_point: PlaceGuess,
    other_meeting_points: Vec<RawPlace>,
    stops_on_the_way: Vec<RawWayStop>,
    venue: RawPlace,
    after: Vec<RawPlace>,
}

#[derive(Deserialize)]
struct WrittenText {
    text: String,
}

/// A new tribe's form filled in from someone's own words.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TribeDraft {
    /// The tribe's name.
    pub name: String,
    /// Where it usually meets; empty when they did not say.
    pub home_area: String,
    /// A Markdown description.
    pub description: String,
}

fn tribe_question() -> Question {
    Question {
        instructions: prompt::TRIBE_DRAFT_SYSTEM,
        schema_name: "tribe_draft",
        max_tokens: 2500,
        style: AnswerStyle::Varied,
        schema: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "home_area": { "type": "string" },
                "description": { "type": "string" }
            },
            "required": ["name", "home_area", "description"],
            "additionalProperties": false
        }),
    }
}

/// The schema for the tribe field: one of the person's tribes by name, or
/// empty; free text when they have no tribes to choose from.
fn tribe_schema(tribes: &[String]) -> serde_json::Value {
    if tribes.is_empty() {
        return json!({ "type": "string" });
    }

    let mut names: Vec<&str> = tribes.iter().map(String::as_str).collect();
    names.push("");
    json!({ "type": "string", "enum": names })
}

/// A place with a note: a name, the area it is in, and a few words.
fn noted_place_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "area": { "type": "string" },
            "facility": { "type": "string" },
            "note": { "type": "string" }
        },
        "required": ["name", "area", "facility", "note"],
        "additionalProperties": false
    })
}

/// A place on the way, which some may skip.
fn way_stop_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "area": { "type": "string" },
            "facility": { "type": "string" },
            "note": { "type": "string" },
            "optional": { "type": "boolean" }
        },
        "required": ["name", "area", "facility", "note", "optional"],
        "additionalProperties": false
    })
}

/// The draft's schema. Each list has a most: without one, the model can
/// repeat the same stop until it runs out of room, and the answer is lost.
fn draft_question(tribes: &[String]) -> Question {
    Question {
        instructions: prompt::DRAFT_SYSTEM,
        schema_name: "event_draft",
        max_tokens: 2000,
        style: AnswerStyle::Varied,
        schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "tribe": tribe_schema(tribes),
                "date": { "type": "string" },
                "time": { "type": "string" },
                "meeting_point": guess_schema(),
                "other_meeting_points": { "type": "array", "items": noted_place_schema(), "maxItems": 10 },
                "stops_on_the_way": { "type": "array", "items": way_stop_schema(), "maxItems": 8 },
                "venue": noted_place_schema(),
                "after": { "type": "array", "items": noted_place_schema(), "maxItems": 3 }
            },
            "required": [
                "title", "tribe", "date", "time", "meeting_point",
                "other_meeting_points", "stops_on_the_way", "venue", "after"
            ],
            "additionalProperties": false
        }),
    }
}

fn writing_question() -> Question {
    Question {
        instructions: prompt::WRITE_SYSTEM,
        schema_name: "description",
        max_tokens: 3500,
        style: AnswerStyle::Varied,
        schema: json!({
            "type": "object",
            "properties": { "text": { "type": "string" } },
            "required": ["text"],
            "additionalProperties": false
        }),
    }
}

/// Whether every character is a digit except the separators at `separators`.
fn digits_with_separators(text: &str, length: usize, separators: &[(usize, u8)]) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != length {
        return false;
    }

    bytes.iter().enumerate().all(|(index, byte)| {
        match separators.iter().find(|(at, _)| *at == index) {
            Some((_, separator)) => byte == separator,
            None => byte.is_ascii_digit(),
        }
    })
}

/// `YYYY-MM-DD`, or `None` for anything else.
fn calendar_date(text: &str) -> Option<String> {
    let text = text.trim();
    digits_with_separators(text, 10, &[(4, b'-'), (7, b'-')]).then(|| text.to_string())
}

/// `HH:MM`, or `None` for anything else.
fn clock_time(text: &str) -> Option<String> {
    let text = text.trim();
    digits_with_separators(text, 5, &[(2, b':')]).then(|| text.to_string())
}

fn draft_stop(kind: StopKind, (place, note): (PlaceGuess, String)) -> DraftStop {
    DraftStop { kind, place, note }
}

/// Every place besides the meeting point, in itinerary order: other meeting
/// points, stops on the way, the venue, then where the group goes after.
fn places_in_order(
    other_meeting_points: Vec<RawPlace>,
    stops_on_the_way: Vec<RawWayStop>,
    venue: RawPlace,
    after: Vec<RawPlace>,
) -> Vec<DraftStop> {
    let mut stops = Vec::new();

    for place in other_meeting_points {
        stops.push(draft_stop(StopKind::Pickup, place.guess()));
    }

    for place in stops_on_the_way {
        let (guess, note, optional) = place.guess();
        let kind = match optional {
            true => StopKind::Optional,
            false => StopKind::Stop,
        };
        stops.push(draft_stop(kind, (guess, note)));
    }

    stops.push(draft_stop(StopKind::Venue, venue.guess()));

    for place in after {
        stops.push(draft_stop(StopKind::After, place.guess()));
    }

    stops
}

/// The stops with a name, in order, each name once and none repeating the
/// meeting point, at most one venue and at most [`MAX_STOPS`].
fn tidy_stops(raw_stops: Vec<DraftStop>, meeting_point: &str) -> Vec<DraftStop> {
    let mut stops: Vec<DraftStop> = Vec::new();
    let meeting_point = meeting_point.trim();

    for stop in raw_stops {
        let name = stop.place.name.trim();
        let nameless = name.is_empty();
        let is_meeting_point = name.eq_ignore_ascii_case(meeting_point);
        let second_venue =
            stop.kind == StopKind::Venue && stops.iter().any(|kept| kept.kind == StopKind::Venue);
        let repeated = stops.iter().any(|kept| {
            kept.place
                .name
                .trim()
                .eq_ignore_ascii_case(stop.place.name.trim())
        });
        if nameless || is_meeting_point || second_venue || repeated || stops.len() == MAX_STOPS {
            continue;
        }

        stops.push(DraftStop {
            kind: stop.kind,
            place: stop.place.tidy(),
            note: clip(&stop.note, 200),
        });
    }

    stops
}

fn tidy_draft(raw: RawDraft, tribes: &[String]) -> EventDraft {
    let meeting_point = raw.meeting_point.tidy();
    let tribe = tribes
        .iter()
        .find(|name| name.eq_ignore_ascii_case(raw.tribe.trim()))
        .cloned();
    let stops = places_in_order(
        raw.other_meeting_points,
        raw.stops_on_the_way,
        raw.venue,
        raw.after,
    );
    let stops = tidy_stops(stops, &meeting_point.name);

    EventDraft {
        title: clip(&raw.title, 120),
        date: calendar_date(&raw.date),
        time: clock_time(&raw.time),
        meeting_point: (!meeting_point.name.is_empty()).then_some(meeting_point),
        stops,
        tribe,
    }
}

impl Brain {
    /// Fills in an event form from what someone said or typed. `today` is
    /// their local date and time, such as "Saturday 2026-10-31 13:05";
    /// `near` names where they are; `tribes` are the names of their tribes,
    /// one of which the model picks for the event when one fits.
    pub async fn draft_event(
        &self,
        said: &str,
        today: &str,
        near: Option<&str>,
        tribes: &[String],
    ) -> Result<EventDraft, BrainError> {
        let mut question = format!("Today is {}.", clip(today, 60));
        if let Some(region) = near {
            question.push_str(&format!(" They are near {}.", clip(region, 120)));
        }

        match tribes {
            [] => question.push_str("\nThey belong to no tribe yet."),
            names => question.push_str(&format!("\nTheir tribes: {}.", names.join("; "))),
        }

        question.push_str(&format!(
            "\nWhat they said:\n\"\"\"\n{}\n\"\"\"",
            clip(said, 2000)
        ));

        let raw: RawDraft = self.ask(draft_question(tribes), question).await?;
        Ok(tidy_draft(raw, tribes))
    }

    /// Fills in a new tribe's form from what someone said or typed.
    pub async fn draft_tribe(&self, said: &str) -> Result<TribeDraft, BrainError> {
        let question = format!("What they said:\n\"\"\"\n{}\n\"\"\"", clip(said, 2000));
        let raw: TribeDraft = self.ask(tribe_question(), question).await?;

        Ok(TribeDraft {
            name: clip(&raw.name, 80),
            home_area: clip(&raw.home_area, 80),
            description: clip(&raw.description, 4000),
        })
    }

    /// Writes an event's description from what someone said and `facts` the
    /// app found to be true, such as the real meeting place, the drive and
    /// the trail's grade, so the model never has to guess them.
    pub async fn describe_event(&self, said: &str, facts: &[String]) -> Result<String, BrainError> {
        let mut question = format!(
            "What they said:\n\"\"\"\n{}\n\"\"\"\nFacts found on the map, all true:\n",
            clip(said, 2000)
        );
        for line in facts {
            question.push_str(&format!("- {}\n", clip(line, 300)));
        }
        question.push_str(
            "Instruction: Write the description for this outing. Use the facts where they help, in plain words (never quote map tags), and never contradict them.",
        );

        let written: WrittenText = self.ask(writing_question(), question).await?;
        Ok(clip(&written.text, LONGEST_DESCRIPTION))
    }

    /// Writes or rewrites a description. `details` are lines about the event
    /// or tribe, `current` is the text so far, and `instruction` says what to do.
    pub async fn write_description(
        &self,
        details: &[String],
        current: &str,
        instruction: &str,
    ) -> Result<String, BrainError> {
        let mut question = String::from("Details:\n");
        for line in details {
            question.push_str(&format!("- {}\n", clip(line, 300)));
        }

        match current.trim() {
            "" => question.push_str("Current text: none yet.\n"),
            text => question.push_str(&format!(
                "Current text:\n\"\"\"\n{}\n\"\"\"\n",
                clip(text, 6000)
            )),
        }
        question.push_str(&format!("Instruction: {}", clip(instruction, 500)));

        let written: WrittenText = self.ask(writing_question(), question).await?;
        Ok(clip(&written.text, LONGEST_DESCRIPTION))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stop(kind: StopKind, name: &str) -> DraftStop {
        DraftStop {
            kind,
            place: PlaceGuess {
                name: name.to_string(),
                area: String::new(),
                facility: String::new(),
            },
            note: String::new(),
        }
    }

    fn noted(name: &str) -> RawPlace {
        RawPlace {
            name: name.to_string(),
            area: String::new(),
            facility: String::new(),
            note: String::new(),
        }
    }

    #[test]
    fn dates_and_clock_times_are_checked() {
        assert_eq!(
            calendar_date(" 2026-11-07 "),
            Some("2026-11-07".to_string())
        );
        assert_eq!(calendar_date("next Saturday"), None);
        assert_eq!(calendar_date("2026/11/07"), None);
        assert_eq!(clock_time("08:30"), Some("08:30".to_string()));
        assert_eq!(clock_time("8:30 AM"), None);
    }

    #[test]
    fn stops_keep_one_venue_and_drop_nameless_and_repeated_ones() {
        let raw = vec![
            stop(StopKind::Stop, "Coffee"),
            stop(StopKind::Venue, "Rattlesnake Ledge"),
            stop(StopKind::Optional, " "),
            stop(StopKind::Venue, "Rattlesnake Lake"),
            stop(StopKind::Stop, "coffee"),
            stop(StopKind::Stop, "Issaquah Park and Ride"),
        ];

        let names: Vec<String> = tidy_stops(raw, "Issaquah Park and Ride")
            .into_iter()
            .map(|stop| stop.place.name)
            .collect();

        assert_eq!(
            names,
            vec!["Coffee".to_string(), "Rattlesnake Ledge".to_string()]
        );
    }

    #[test]
    fn each_field_becomes_its_kind_in_itinerary_order() {
        let way = RawWayStop {
            name: "Snoqualmie Falls".to_string(),
            area: String::new(),
            facility: String::new(),
            note: String::new(),
            optional: true,
        };
        let stops = places_in_order(
            vec![noted("Bellevue Transit Center"), noted("Kent Station")],
            vec![way],
            noted("Rattlesnake Ledge Trailhead"),
            vec![noted("Twede's Cafe")],
        );

        let kinds: Vec<StopKind> = stops.iter().map(|stop| stop.kind).collect();
        assert_eq!(
            kinds,
            vec![
                StopKind::Pickup,
                StopKind::Pickup,
                StopKind::Optional,
                StopKind::Venue,
                StopKind::After
            ]
        );
    }

    #[test]
    fn only_one_of_their_own_tribes_is_kept() {
        let raw = RawDraft {
            title: "Hike".to_string(),
            tribe: "puget sound trail crew".to_string(),
            date: String::new(),
            time: String::new(),
            meeting_point: PlaceGuess {
                name: String::new(),
                area: String::new(),
                facility: String::new(),
            },
            other_meeting_points: Vec::new(),
            stops_on_the_way: Vec::new(),
            venue: noted(""),
            after: Vec::new(),
        };
        let tribes = vec!["Puget Sound Trail Crew".to_string()];

        assert_eq!(
            tidy_draft(raw, &tribes).tribe.as_deref(),
            Some("Puget Sound Trail Crew")
        );
    }
}
