//! Related words for a search: what someone typing "hiking" probably also
//! means, such as "hike", "trail" and "trek", so the app finds tribes and
//! events that use other words for the same thing.

use serde::Deserialize;
use serde_json::json;

use crate::client::{Brain, Question};
use crate::{BrainError, clip, prompt};

/// Most related words kept.
const MOST_WORDS: usize = 8;

/// Longest related word or name kept, in characters.
const LONGEST_WORD: usize = 40;

#[derive(Deserialize)]
struct RelatedWords {
    words: Vec<String>,
}

fn related_question() -> Question {
    Question {
        instructions: prompt::RELATED_SYSTEM,
        schema_name: "related_words",
        max_tokens: 200,
        schema: json!({
            "type": "object",
            "properties": {
                "words": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["words"],
            "additionalProperties": false
        }),
    }
}

/// The words kept: trimmed, lower case, not empty, not too long, not in the search, each once.
fn tidy(words: Vec<String>, search: &str) -> Vec<String> {
    let typed = search.to_lowercase();

    let mut kept: Vec<String> = Vec::new();
    for word in words {
        let word = word.trim().to_lowercase();
        let usable = !word.is_empty() && word.chars().count() <= LONGEST_WORD;
        if !usable || typed.contains(&word) || kept.contains(&word) {
            continue;
        }

        kept.push(word);
        if kept.len() == MOST_WORDS {
            break;
        }
    }
    kept
}

impl Brain {
    /// Words and names that someone searching `search` in an outings app probably also means.
    pub async fn related_words(&self, search: &str) -> Result<Vec<String>, BrainError> {
        let question = format!("The search: \"{}\"", clip(search, 150));
        let answer: RelatedWords = self.ask(related_question(), question).await?;

        Ok(tidy(answer.words, search))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_already_searched_and_repeats_are_dropped() {
        let answer = vec![
            " Trail ".to_string(),
            "hiking".to_string(),
            "trail".to_string(),
            String::new(),
            "trek".to_string(),
        ];

        assert_eq!(tidy(answer, "Hiking"), vec!["trail", "trek"]);
    }
}
