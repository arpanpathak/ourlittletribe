//! The planning model: what a group should bring, what the conditions mean,
//! what a place search means, and filling in or writing an event from
//! someone's own words.
//!
//! Every job writes its facts as plain lines, asks one question whose answer
//! must fit a JSON schema, and checks that answer again here before anything
//! is saved or shown. Any server with an OpenAI-style `/v1/chat/completions`
//! works; on the Jetson Thor it is TensorRT Edge-LLM serving Qwen3.6.
//!
//! | Module | Job |
//! |---|---|
//! | [`items`] | the packing list, and items that answer a search |
//! | [`briefing`] | what the forecast means for this plan |
//! | [`places`] | reading a map search, and choosing among real places |
//! | [`drafting`] | an event or a tribe from someone's words, and descriptions |
//! | [`covers`] | the scene for a tribe or event cover |

pub mod briefing;
mod client;
pub mod covers;
pub mod drafting;
pub mod items;
pub mod places;
mod prompt;

use std::time::Duration;

pub use client::Brain;
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
    /// The one-at-a-time lock was closed; only happens while shutting down.
    #[error("model is shutting down")]
    Closed,
}

/// Where the model is and what to call it.
#[derive(Debug, Clone)]
pub struct BrainConfig {
    /// Base URL ending in `/v1`, such as `http://127.0.0.1:8081/v1`.
    pub base_url: String,
    /// Model id; when `None`, the first model the server lists is used.
    pub model: Option<String>,
    /// Bearer key, for servers that need one.
    pub api_key: Option<String>,
    /// How long one answer may take.
    pub timeout: Duration,
}

/// The text trimmed and cut to at most `max_chars` characters.
pub(crate) fn clip(text: &str, max_chars: usize) -> String {
    text.trim().chars().take(max_chars).collect()
}

/// Where the person is, as a sentence for a prompt, or nothing when unknown.
pub(crate) fn whereabouts(near: Option<&str>) -> String {
    match near {
        Some(region) => format!("\nThe person is near {}.", clip(region, 120)),
        None => String::new(),
    }
}
