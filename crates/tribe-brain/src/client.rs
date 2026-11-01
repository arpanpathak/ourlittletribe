//! The HTTP client for the model server, and the one way every job asks a question.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use tokio::sync::{OnceCell, Semaphore};

use crate::{BrainConfig, BrainError};

/// One kind of question: its instructions and the shape its answer must have.
pub(crate) struct Question {
    /// The system prompt.
    pub instructions: &'static str,
    /// A short name for the answer's schema, such as "briefing".
    pub schema_name: &'static str,
    /// The JSON schema the answer must match.
    pub schema: serde_json::Value,
    /// The longest answer allowed, in tokens.
    pub max_tokens: u32,
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

/// The client. Cheap to share behind an `Arc`; asks one question at a time.
pub struct Brain {
    /// The HTTP client, with the configured timeout.
    http: reqwest::Client,
    /// Where the server is.
    config: BrainConfig,
    /// The model id, found once.
    model: OnceCell<String>,
    /// A single permit, so two jobs never split the GPU.
    one_at_a_time: Semaphore,
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

    /// The first model the server lists.
    async fn listed_model(&self) -> Result<String, BrainError> {
        let url = format!("{}/models", self.config.base_url);
        let response = self.authorize(self.http.get(url)).send().await?;
        if !response.status().is_success() {
            return Err(BrainError::Status(response.status()));
        }

        let listed: ModelList = response.json().await?;
        let first = listed.data.into_iter().next().ok_or(BrainError::NoModel)?;
        Ok(first.id)
    }

    /// The model id in use: the configured one, or the server's first, asked once.
    pub async fn model_name(&self) -> Result<String, BrainError> {
        let name = self
            .model
            .get_or_try_init(|| async {
                match &self.config.model {
                    Some(configured) => Ok(configured.clone()),
                    None => self.listed_model().await,
                }
            })
            .await?;
        Ok(name.clone())
    }

    /// Asks `question` with `facts` as the person's message and parses the answer.
    /// Sends one chat request, one at a time, and returns the answer's text.
    async fn complete(&self, mut body: serde_json::Value) -> Result<String, BrainError> {
        let Ok(_turn) = self.one_at_a_time.acquire().await else {
            return Err(BrainError::Closed);
        };
        body["model"] = json!(self.model_name().await?);

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
        let first = completion.choices.into_iter().next();
        first
            .and_then(|choice| choice.message.content)
            .ok_or(BrainError::EmptyAnswer)
    }

    /// Asks `question` about `facts`; the answer must match the question's JSON schema.
    pub(crate) async fn ask<Answer: DeserializeOwned>(
        &self,
        question: Question,
        facts: String,
    ) -> Result<Answer, BrainError> {
        let body = json!({
            "temperature": 0.3,
            "max_tokens": question.max_tokens,
            "chat_template_kwargs": { "enable_thinking": false },
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": question.schema_name, "strict": true, "schema": question.schema }
            },
            "messages": [
                { "role": "system", "content": question.instructions },
                { "role": "user", "content": facts }
            ]
        });

        let content = self.complete(body).await?;
        Ok(serde_json::from_str(content.trim())?)
    }

    /// Has the model write free text, such as an SVG drawing, from `instructions` and `request`.
    pub(crate) async fn write(
        &self,
        instructions: &str,
        request: String,
        max_tokens: u32,
        temperature: f64,
    ) -> Result<String, BrainError> {
        let body = json!({
            "temperature": temperature,
            "max_tokens": max_tokens,
            "chat_template_kwargs": { "enable_thinking": false },
            "messages": [
                { "role": "system", "content": instructions },
                { "role": "user", "content": request }
            ]
        });

        self.complete(body).await
    }
}
