//! Asks a language model what a group should bring.
//!
//! The model gets the facts of one trip, written out as plain lines: the
//! organiser's description, the forecast and elevation at the meeting point,
//! the drive, the daylight, the group size, what is already on the list, and
//! the pairings learned from what earlier groups actually bought. It answers
//! with JSON constrained by a schema, and every field is checked again here
//! before it reaches the database.
//!
//! Any server with an OpenAI-style `/v1/chat/completions` works. On the
//! Jetson Thor this is TensorRT Edge-LLM serving Qwen3.6 on `127.0.0.1:8081`.
//! Only one request runs at a time, so planning never stacks GPU work.

mod prompt;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{OnceCell, Semaphore};
use tribe_core::osm::is_plain_tag;

pub use prompt::{DriveFacts, TripFacts, WeatherFacts};

/// Everything that can go wrong asking the model.
#[derive(Debug, thiserror::Error)]
pub enum BrainError {
    /// The request did not complete.
    #[error("model server: {0}")]
    Http(#[from] reqwest::Error),
    /// The server answered with an error status.
    #[error("model server answered {0}")]
    Status(reqwest::StatusCode),
    /// The server lists no model and none was configured.
    #[error("model server lists no model")]
    NoModel,
    /// The answer had no message content.
    #[error("model returned no answer")]
    EmptyAnswer,
    /// The answer was not the JSON the schema asks for.
    #[error("model answer was not valid JSON: {0}")]
    BadJson(#[from] serde_json::Error),
    /// The planning lock was closed; only happens while shutting down.
    #[error("model is shutting down")]
    Closed,
}

/// Where the model is and what to call it.
#[derive(Debug, Clone)]
pub struct BrainConfig {
    /// Base URL ending in `/v1`, such as `http://127.0.0.1:8081/v1`.
    pub base_url: String,
    /// Model id; when `None` the first model the server lists is used.
    pub model: Option<String>,
    /// Bearer key, for servers that need one.
    pub api_key: Option<String>,
    /// How long one answer may take.
    pub timeout: Duration,
}

/// One thing to bring, as the model suggested it and after checking.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlannedItem {
    /// What to bring.
    pub name: String,
    /// Which fact it answers to.
    pub why: String,
    /// `personal` (one each) or `shared` (one for the group).
    pub scope: String,
    /// How many for the whole group.
    pub quantity: i64,
    /// OpenStreetMap `shop` values of stores that sell it.
    pub shop_tags: Vec<String>,
}

#[derive(Deserialize)]
struct PlanAnswer {
    items: Vec<PlannedItem>,
}

/// A real place the model thinks a map search means.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlaceGuess {
    /// The place's own official name, such as "Henry M. Jackson Memorial Visitor Center".
    pub name: String,
    /// The town, park or region it is in, such as "Mount Rainier National Park, Washington".
    pub area: String,
}

#[derive(Deserialize)]
struct PlaceAnswer {
    places: Vec<PlaceGuess>,
}

#[derive(Deserialize)]
struct ChoiceAnswer {
    best: Vec<i64>,
}

fn choice_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": { "best": { "type": "array", "items": { "type": "integer" } } },
        "required": ["best"],
        "additionalProperties": false
    })
}

/// How many guesses to look up for one search.
const MAX_PLACE_GUESSES: usize = 3;

fn place_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "places": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "area": { "type": "string" }
                    },
                    "required": ["name", "area"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["places"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
struct ChatCompletion {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ModelList {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

const MAX_ITEMS: usize = 14;

/// The client. Cheap to share behind an `Arc`.
pub struct Brain {
    http: reqwest::Client,
    config: BrainConfig,
    model: OnceCell<String>,
    one_at_a_time: Semaphore,
}

fn clip(text: &str, max_chars: usize) -> String {
    text.trim().chars().take(max_chars).collect()
}

/// Checks and tidies the model's items: trims text, bounds numbers, drops bad tags,
/// drops items with no name or repeated names, and keeps at most [`MAX_ITEMS`].
pub fn clean_items(raw_items: Vec<PlannedItem>, already_listed: &[String]) -> Vec<PlannedItem> {
    let mut seen: Vec<String> = already_listed
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let mut cleaned = Vec::new();
    for raw in raw_items {
        let name = clip(&raw.name, 80);
        let lowered = name.to_lowercase();
        if name.is_empty() || seen.contains(&lowered) {
            continue;
        }
        seen.push(lowered);
        let scope = match raw.scope.as_str() {
            "shared" => "shared",
            _ => "personal",
        };
        let mut shop_tags = Vec::new();
        for tag in raw.shop_tags {
            let tag = tag.trim().to_lowercase();
            if is_plain_tag(&tag) && tag != "shop" && !shop_tags.contains(&tag) {
                shop_tags.push(tag);
            }
        }
        cleaned.push(PlannedItem {
            name,
            why: clip(&raw.why, 200),
            scope: scope.to_string(),
            quantity: raw.quantity.clamp(1, 500),
            shop_tags,
        });
        if cleaned.len() == MAX_ITEMS {
            break;
        }
    }
    cleaned
}

fn answer_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "why": { "type": "string" },
                        "scope": { "type": "string", "enum": ["personal", "shared"] },
                        "quantity": { "type": "integer" },
                        "shop_tags": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
                    },
                    "required": ["name", "why", "scope", "quantity", "shop_tags"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["items"],
        "additionalProperties": false
    })
}

impl Brain {
    /// Builds a client for the server in `config`. Nothing is sent until the first question.
    pub fn new(config: BrainConfig) -> Result<Brain, BrainError> {
        let http = reqwest::Client::builder().timeout(config.timeout).build()?;
        Ok(Brain {
            http,
            config,
            model: OnceCell::new(),
            one_at_a_time: Semaphore::new(1),
        })
    }

    fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.config.api_key {
            Some(key) => request.bearer_auth(key),
            None => request,
        }
    }

    /// The model id in use, asking the server once if none was configured.
    pub async fn model_name(&self) -> Result<String, BrainError> {
        let name = self
            .model
            .get_or_try_init(|| async {
                if let Some(configured) = &self.config.model {
                    return Ok(configured.clone());
                }
                let url = format!("{}/models", self.config.base_url);
                let response = self.authorize(self.http.get(url)).send().await?;
                if !response.status().is_success() {
                    return Err(BrainError::Status(response.status()));
                }
                let listed: ModelList = response.json().await?;
                listed
                    .data
                    .into_iter()
                    .next()
                    .map(|entry| entry.id)
                    .ok_or(BrainError::NoModel)
            })
            .await?;
        Ok(name.clone())
    }

    /// Asks one question whose answer must fit `schema`, and parses it.
    async fn ask_json<T: serde::de::DeserializeOwned>(
        &self,
        system: &str,
        user: String,
        schema_name: &str,
        schema: serde_json::Value,
        max_tokens: u32,
    ) -> Result<T, BrainError> {
        let _turn = self
            .one_at_a_time
            .acquire()
            .await
            .map_err(|_| BrainError::Closed)?;
        let model = self.model_name().await?;
        let body = json!({
            "model": model,
            "temperature": 0.3,
            "max_tokens": max_tokens,
            "chat_template_kwargs": { "enable_thinking": false },
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": schema_name, "strict": true, "schema": schema }
            },
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ]
        });
        let url = format!("{}/chat/completions", self.config.base_url);
        let response = self
            .authorize(self.http.post(url))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(BrainError::Status(response.status()));
        }
        let completion: ChatCompletion = response.json().await?;
        let content = completion
            .choices
            .into_iter()
            .next()
            .and_then(|choice| choice.message.content)
            .ok_or(BrainError::EmptyAnswer)?;
        Ok(serde_json::from_str(content.trim())?)
    }

    async fn ask_for_items(
        &self,
        system: &str,
        user: String,
    ) -> Result<Vec<PlannedItem>, BrainError> {
        let answer: PlanAnswer = self
            .ask_json(system, user, "prep_list", answer_schema(), 1800)
            .await?;
        Ok(answer.items)
    }

    /// What real places someone most likely means by what they typed into a
    /// map search, such as "mt rainier henry jackson". `near` names where they
    /// are, such as "Seattle, Washington", to settle ambiguous names.
    pub async fn interpret_place_search(
        &self,
        typed: &str,
        near: Option<&str>,
    ) -> Result<Vec<PlaceGuess>, BrainError> {
        let mut user = format!("Typed: {}", clip(typed, 150));
        if let Some(region) = near {
            user.push_str(&format!("\nThe person is near {}.", clip(region, 120)));
        }
        let answer: PlaceAnswer = self
            .ask_json(
                prompt::PLACE_SYSTEM,
                user,
                "place_guesses",
                place_schema(),
                300,
            )
            .await?;
        Ok(answer
            .places
            .into_iter()
            .map(|guess| PlaceGuess {
                name: clip(guess.name.trim(), 120).to_string(),
                area: clip(guess.area.trim(), 120).to_string(),
            })
            .filter(|guess| !guess.name.is_empty())
            .take(MAX_PLACE_GUESSES)
            .collect())
    }

    /// Which of `candidates` (real places, one line each) match what someone
    /// typed into a map search, best first, as indexes into `candidates`.
    pub async fn choose_places(
        &self,
        typed: &str,
        near: Option<&str>,
        candidates: &[String],
    ) -> Result<Vec<usize>, BrainError> {
        let mut user = format!("Typed: {}", clip(typed, 150));
        if let Some(region) = near {
            user.push_str(&format!("\nThe person is near {}.", clip(region, 120)));
        }
        user.push_str("\nPlaces found on the map:");
        for (index, line) in candidates.iter().enumerate() {
            user.push_str(&format!("\n{index}. {}", clip(line, 200)));
        }
        let answer: ChoiceAnswer = self
            .ask_json(
                prompt::CHOOSE_PLACE_SYSTEM,
                user,
                "place_choice",
                choice_schema(),
                120,
            )
            .await?;
        let mut chosen: Vec<usize> = Vec::new();
        for index in answer.best {
            if let Ok(index) = usize::try_from(index)
                && index < candidates.len()
                && !chosen.contains(&index)
            {
                chosen.push(index);
            }
        }
        Ok(chosen)
    }

    /// What this group should bring, given the facts of the trip.
    pub async fn plan_items(&self, facts: &TripFacts) -> Result<Vec<PlannedItem>, BrainError> {
        let raw = self
            .ask_for_items(prompt::PLAN_SYSTEM, facts.describe())
            .await?;
        Ok(clean_items(raw, &facts.already_listed))
    }

    /// Items that answer a person's search, such as "something for mosquitoes", for this trip.
    pub async fn items_for_search(
        &self,
        query: &str,
        facts: &TripFacts,
    ) -> Result<Vec<PlannedItem>, BrainError> {
        let user = format!(
            "{}\nSearch from one attendee: {}\nReturn up to 5 items that answer the search for this trip.",
            facts.describe(),
            clip(query, 200)
        );
        let raw = self.ask_for_items(prompt::SEARCH_SYSTEM, user).await?;
        let mut items = clean_items(raw, &[]);
        items.truncate(5);
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(name: &str, scope: &str, quantity: i64, tags: &[&str]) -> PlannedItem {
        PlannedItem {
            name: name.to_string(),
            why: "because".to_string(),
            scope: scope.to_string(),
            quantity,
            shop_tags: tags.iter().map(|tag| tag.to_string()).collect(),
        }
    }

    #[test]
    fn cleaning_drops_repeats_bad_tags_and_bounds_quantity() {
        let items = vec![
            raw(
                "Microspikes",
                "personal",
                8,
                &["shop", "outdoor", "Sports ", "x\"]);"],
            ),
            raw("microspikes", "personal", 8, &["outdoor"]),
            raw("Water", "personal", 9_999, &["supermarket"]),
            raw("", "shared", 1, &[]),
            raw("First-aid kit", "group", 0, &["chemist"]),
        ];
        let cleaned = clean_items(items, &["water".to_string()]);
        let names: Vec<&str> = cleaned.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["Microspikes", "First-aid kit"]);
        let Some(spikes) = cleaned.first() else {
            panic!("missing");
        };
        assert_eq!(
            spikes.shop_tags,
            vec!["outdoor".to_string(), "sports".to_string()]
        );
        let Some(kit) = cleaned.get(1) else {
            panic!("missing");
        };
        assert_eq!(kit.scope, "personal");
        assert_eq!(kit.quantity, 1);
    }

    #[test]
    fn cleaning_keeps_at_most_the_limit() {
        let items: Vec<PlannedItem> = (0..30)
            .map(|number| raw(&format!("Item {number}"), "shared", 1, &[]))
            .collect();
        assert_eq!(clean_items(items, &[]).len(), MAX_ITEMS);
    }
}
