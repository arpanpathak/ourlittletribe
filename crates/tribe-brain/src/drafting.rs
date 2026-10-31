//! Writing for people: filling in an event from what someone said, and
//! writing or rewriting a description.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tribe_core::itinerary::StopKind;

use crate::client::{Brain, Question};
use crate::places::{PlaceGuess, guess_schema};
use crate::{BrainError, clip, prompt};

/// Most places besides the meeting point a draft may have.
const MAX_STOPS: usize = 6;

/// An event form filled in from someone's own words.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EventDraft {
    /// Short title.
    pub title: String,
    /// A Markdown description for the group.
    pub description: String,
    /// The day, as `YYYY-MM-DD`, when they said one.
    pub date: Option<String>,
    /// The start time, as 24-hour `HH:MM`, when they said one.
    pub time: Option<String>,
    /// Where people gather first, when they said.
    pub meeting_point: Option<PlaceGuess>,
    /// Other places, in order; at most one venue.
    pub stops: Vec<DraftStop>,
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

/// The draft as the model writes it, before checking.
#[derive(Deserialize)]
struct RawDraft {
    title: String,
    description: String,
    date: String,
    time: String,
    meeting_point: PlaceGuess,
    stops: Vec<DraftStop>,
}

#[derive(Deserialize)]
struct WrittenText {
    text: String,
}

fn draft_question() -> Question {
    Question {
        instructions: prompt::DRAFT_SYSTEM,
        schema_name: "event_draft",
        max_tokens: 1200,
        schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "description": { "type": "string" },
                "date": { "type": "string" },
                "time": { "type": "string" },
                "meeting_point": guess_schema(),
                "stops": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["stop", "optional", "venue"] },
                            "place": guess_schema(),
                            "note": { "type": "string" }
                        },
                        "required": ["kind", "place", "note"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["title", "description", "date", "time", "meeting_point", "stops"],
            "additionalProperties": false
        }),
    }
}

fn writing_question() -> Question {
    Question {
        instructions: prompt::WRITE_SYSTEM,
        schema_name: "description",
        max_tokens: 1200,
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

/// The stops with a name, in order, at most one venue and at most [`MAX_STOPS`].
fn tidy_stops(raw_stops: Vec<DraftStop>) -> Vec<DraftStop> {
    let mut stops: Vec<DraftStop> = Vec::new();

    for stop in raw_stops {
        let nameless = stop.place.name.trim().is_empty();
        let second_venue =
            stop.kind == StopKind::Venue && stops.iter().any(|kept| kept.kind == StopKind::Venue);
        if nameless || second_venue || stops.len() == MAX_STOPS {
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

fn tidy_draft(raw: RawDraft) -> EventDraft {
    let meeting_point = raw.meeting_point.tidy();

    EventDraft {
        title: clip(&raw.title, 120),
        description: clip(&raw.description, 6000),
        date: calendar_date(&raw.date),
        time: clock_time(&raw.time),
        meeting_point: (!meeting_point.name.is_empty()).then_some(meeting_point),
        stops: tidy_stops(raw.stops),
    }
}

impl Brain {
    /// Fills in an event form from what someone said or typed. `today` is
    /// their local date and time, such as "Saturday 2026-10-31 13:05";
    /// `near` names where they are.
    pub async fn draft_event(
        &self,
        said: &str,
        today: &str,
        near: Option<&str>,
    ) -> Result<EventDraft, BrainError> {
        let mut question = format!("Today is {}.", clip(today, 60));
        if let Some(region) = near {
            question.push_str(&format!(" They are near {}.", clip(region, 120)));
        }
        question.push_str(&format!(
            "\nWhat they said:\n\"\"\"\n{}\n\"\"\"",
            clip(said, 2000)
        ));

        let raw: RawDraft = self.ask(draft_question(), question).await?;
        Ok(tidy_draft(raw))
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
        Ok(clip(&written.text, 7000))
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
            },
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
    fn stops_keep_one_venue_and_drop_nameless_ones() {
        let raw = vec![
            stop(StopKind::Stop, "Coffee"),
            stop(StopKind::Venue, "Rattlesnake Ledge"),
            stop(StopKind::Optional, " "),
            stop(StopKind::Venue, "Rattlesnake Lake"),
        ];

        let names: Vec<String> = tidy_stops(raw)
            .into_iter()
            .map(|stop| stop.place.name)
            .collect();

        assert_eq!(
            names,
            vec!["Coffee".to_string(), "Rattlesnake Ledge".to_string()]
        );
    }
}
