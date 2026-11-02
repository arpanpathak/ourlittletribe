//! Map search: reading what someone typed the way they meant it, and choosing
//! among the real places found for it.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::{AnswerStyle, Brain, Question};
use crate::{BrainError, clip, prompt, whereabouts};

/// Most guesses looked up for one search.
const MAX_GUESSES: usize = 3;

/// A real place the model thinks someone means, or a thing at a place: the
/// parking at a trail, a café in a town.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaceGuess {
    /// The place's own name, such as "Henry M. Jackson Memorial Visitor Center".
    pub name: String,
    /// The town, park or region it is in, such as "Mount Rainier National Park, Washington".
    pub area: String,
    /// The OpenStreetMap tag of the thing at the place they want instead of
    /// the place itself, such as "amenity=parking"; empty for the place.
    #[serde(default)]
    pub facility: String,
}

impl PlaceGuess {
    /// The guess with its text trimmed and bounded.
    pub(crate) fn tidy(self) -> PlaceGuess {
        PlaceGuess {
            name: clip(&self.name, 120),
            area: clip(&self.area, 120),
            facility: clip(&self.facility, 80),
        }
    }
}

#[derive(Deserialize)]
struct GuessesAnswer {
    places: Vec<PlaceGuess>,
}

#[derive(Deserialize)]
struct ChoiceAnswer {
    best: Vec<i64>,
}

/// The JSON schema of a place guess, shared with event drafts.
pub(crate) fn guess_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "area": { "type": "string" },
            "facility": { "type": "string" }
        },
        "required": ["name", "area", "facility"],
        "additionalProperties": false
    })
}

fn guesses_question() -> Question {
    Question {
        instructions: prompt::PLACE_SYSTEM,
        schema_name: "place_guesses",
        max_tokens: 400,
        style: AnswerStyle::Exact,
        schema: json!({
            "type": "object",
            "properties": { "places": { "type": "array", "items": guess_schema() } },
            "required": ["places"],
            "additionalProperties": false
        }),
    }
}

fn choice_question() -> Question {
    Question {
        instructions: prompt::CHOOSE_PLACE_SYSTEM,
        schema_name: "place_choice",
        max_tokens: 120,
        style: AnswerStyle::Exact,
        schema: json!({
            "type": "object",
            "properties": { "best": { "type": "array", "items": { "type": "integer" } } },
            "required": ["best"],
            "additionalProperties": false
        }),
    }
}

/// The numbers the model chose that point at a candidate, each once, in its order.
fn valid_choices(numbers: Vec<i64>, candidate_count: usize) -> Vec<usize> {
    let mut chosen: Vec<usize> = Vec::new();
    for number in numbers {
        let Ok(index) = usize::try_from(number) else {
            continue;
        };
        if index < candidate_count && !chosen.contains(&index) {
            chosen.push(index);
        }
    }
    chosen
}

impl Brain {
    /// What real places someone most likely means by what they typed into a
    /// map search, such as "mt rainier henry jackson". `near` names where they
    /// are, such as "Seattle, Washington", to settle ambiguous names.
    pub async fn interpret_place_search(
        &self,
        typed: &str,
        near: Option<&str>,
    ) -> Result<Vec<PlaceGuess>, BrainError> {
        let question = format!("Typed: {}{}", clip(typed, 150), whereabouts(near));
        let answer: GuessesAnswer = self.ask(guesses_question(), question).await?;

        let guesses = answer
            .places
            .into_iter()
            .map(PlaceGuess::tidy)
            .filter(|guess| !guess.name.is_empty())
            .take(MAX_GUESSES)
            .collect();
        Ok(guesses)
    }

    /// Which of `candidates` (real places, one line each) match what someone
    /// typed, best first, as indexes into `candidates`.
    pub async fn choose_places(
        &self,
        typed: &str,
        near: Option<&str>,
        candidates: &[String],
    ) -> Result<Vec<usize>, BrainError> {
        let mut question = format!(
            "Typed: {}{}\nPlaces found on the map:",
            clip(typed, 150),
            whereabouts(near)
        );
        for (index, line) in candidates.iter().enumerate() {
            question.push_str(&format!("\n{index}. {}", clip(line, 200)));
        }

        let answer: ChoiceAnswer = self.ask(choice_question(), question).await?;
        Ok(valid_choices(answer.best, candidates.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_numbers_of_real_candidates_are_kept_once() {
        assert_eq!(valid_choices(vec![2, -1, 2, 7, 0], 3), vec![2, 0]);
    }
}
