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
    /// Whether the same facts should always get the same answer.
    pub style: AnswerStyle,
}

/// How much an answer may vary between two askings of the same question.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AnswerStyle {
    /// Always the same answer, for short readings and choices, such as
    /// which place a search means. Not for long answers: with no variety at
    /// all, a small model can repeat itself until it runs out of room.
    Exact,
    /// A little variety, for writing.
    Varied,
}

impl AnswerStyle {
    fn temperature(self) -> f64 {
        match self {
            AnswerStyle::Exact => 0.0,
            AnswerStyle::Varied => 0.3,
        }
    }
}

/// Whether to keep listening to an answer as it streams in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Listening {
    /// Keep going.
    Go,
    /// Stop: the model stops writing, and the answer is [`BrainError::Stopped`].
    Stop,
}

/// One piece of a streamed answer.
#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

/// What one line of the stream holds.
enum StreamLine {
    /// Some text of the answer.
    Piece(String),
    /// The answer is complete.
    Done,
    /// Nothing to use, such as a blank line or a role-only chunk.
    Nothing,
}

/// Reads one `data: …` line of the server-sent stream.
fn read_stream_line(line: &[u8]) -> Result<StreamLine, BrainError> {
    let line = String::from_utf8_lossy(line);
    let Some(data) = line.trim().strip_prefix("data:") else {
        return Ok(StreamLine::Nothing);
    };

    let data = data.trim();
    if data == "[DONE]" {
        return Ok(StreamLine::Done);
    }

    let chunk: StreamChunk = serde_json::from_str(data)?;
    let piece = chunk
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.delta.content);

    match piece {
        Some(text) if !text.is_empty() => Ok(StreamLine::Piece(text)),
        _ => Ok(StreamLine::Nothing),
    }
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

    /// Sends one chat request, one at a time, and returns the answer's text.
    ///
    /// The answer is always streamed, even when nobody watches it arrive. The
    /// model server stops writing as soon as a streamed request's connection
    /// closes, but finishes a plain request even after the caller has gone.
    /// So when this future is dropped (a closed tab, a Stop button), the GPU
    /// is free again at once instead of minutes later. `on_piece` sees each
    /// piece as it arrives and can stop the answer.
    async fn complete(
        &self,
        mut body: serde_json::Value,
        on_piece: &mut (dyn FnMut(&str) -> Listening + Send),
    ) -> Result<String, BrainError> {
        let Ok(_turn) = self.one_at_a_time.acquire().await else {
            return Err(BrainError::Closed);
        };
        body["model"] = json!(self.model_name().await?);
        body["stream"] = json!(true);

        let url = format!("{}/chat/completions", self.config.base_url);
        let mut response = self
            .authorize(self.http.post(url))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(BrainError::Status(response.status()));
        }

        let mut answer = String::new();
        let mut unread: Vec<u8> = Vec::new();

        while let Some(bytes) = response.chunk().await? {
            unread.extend_from_slice(&bytes);

            while let Some(end) = unread.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = unread.drain(..=end).collect();

                match read_stream_line(&line)? {
                    StreamLine::Done => return finished(answer),
                    StreamLine::Nothing => {}
                    StreamLine::Piece(text) => {
                        answer.push_str(&text);
                        if on_piece(&text) == Listening::Stop {
                            return Err(BrainError::Stopped);
                        }
                    }
                }
            }
        }

        finished(answer)
    }

    /// Asks `question` about `facts`; the answer must match the question's JSON schema.
    pub(crate) async fn ask<Answer: DeserializeOwned>(
        &self,
        question: Question,
        facts: String,
    ) -> Result<Answer, BrainError> {
        let body = json!({
            "temperature": question.style.temperature(),
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

        let content = self.complete(body, &mut |_| Listening::Go).await?;
        match serde_json::from_str(content.trim()) {
            Ok(answer) => Ok(answer),
            Err(error) => {
                let tail: String = content
                    .chars()
                    .rev()
                    .take(600)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                tracing::warn!(%error, question = question.schema_name, tail, "the model's answer was not valid JSON");
                Err(error.into())
            }
        }
    }

    /// Has the model write free text, such as an SVG drawing, from
    /// `instructions` and `request`. `on_piece` sees the text as it comes and
    /// can stop it.
    pub(crate) async fn write(
        &self,
        instructions: &str,
        request: String,
        max_tokens: u32,
        temperature: f64,
        on_piece: &mut (dyn FnMut(&str) -> Listening + Send),
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

        self.complete(body, on_piece).await
    }
}

/// The whole answer, or [`BrainError::EmptyAnswer`] when there was none.
fn finished(answer: String) -> Result<String, BrainError> {
    if answer.trim().is_empty() {
        return Err(BrainError::EmptyAnswer);
    }

    Ok(answer)
}
