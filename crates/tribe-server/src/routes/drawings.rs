//! Cover drawings, streamed as the model draws them. The page shows the
//! drawing growing, and its Stop button, or closing the tab, ends the
//! request, which stops the model at once instead of leaving it drawing for
//! nobody while every other job waits.

use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::response::{IntoResponse, Response};
use futures_core::Stream;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tribe_brain::{Brain, BrainError, Listening};
use tribe_media::svg::clean_svg;

use super::{bounded, model};
use crate::auth::CurrentUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Longest scene accepted, characters.
const LONGEST_SCENE: usize = 2500;

/// Shortest scene accepted, characters.
const SHORTEST_SCENE: usize = 20;

/// Body of `POST /api/cover-drawings`.
#[derive(Deserialize)]
pub struct CoverDrawingRequest {
    /// The scene to draw, 20 to 2,500 characters.
    scene: String,
}

/// One line of the answer, sent as soon as it happens.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum DrawingUpdate {
    /// More of the model's SVG as it writes it, for a preview only; it is
    /// not cleaned, so the page shows it as a picture, never as markup.
    Piece {
        /// The new text.
        text: String,
    },
    /// The finished drawing, cleaned: plain drawing elements only.
    Done {
        /// One SVG document.
        svg: String,
    },
    /// The drawing could not be made.
    Failed {
        /// What went wrong, for the person.
        message: String,
    },
}

/// The updates as lines of JSON, one per update, for the response body.
struct UpdateLines {
    /// Where the drawing task sends its updates.
    received: UnboundedReceiver<DrawingUpdate>,
}

impl Stream for UpdateLines {
    type Item = Result<String, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let update = match self.received.poll_recv(context) {
            Poll::Ready(update) => update,
            Poll::Pending => return Poll::Pending,
        };

        Poll::Ready(update.map(|update| Ok(as_line(&update))))
    }
}

fn as_line(update: &DrawingUpdate) -> String {
    let json = serde_json::to_string(update).unwrap_or_default();
    format!("{json}\n")
}

/// What to tell the person when the drawing fails.
fn failure_message(error: &BrainError) -> String {
    match error {
        BrainError::EmptyAnswer => "The model didn't draw anything. Try again.".to_string(),
        BrainError::Http(_) | BrainError::Status(_) => {
            "The model isn't answering right now. Try again in a minute.".to_string()
        }
        other => format!("The drawing failed: {other}"),
    }
}

/// The cleaned drawing from the model's answer, or what went wrong.
fn finished_drawing(drawn: Result<String, BrainError>) -> DrawingUpdate {
    let svg = match drawn {
        Ok(svg) => svg,
        Err(error) => {
            return DrawingUpdate::Failed {
                message: failure_message(&error),
            };
        }
    };

    match clean_svg(&svg) {
        Ok(svg) => DrawingUpdate::Done { svg },
        Err(error) => {
            tracing::warn!(%error, "the model's drawing was not usable");
            DrawingUpdate::Failed {
                message: "The model's drawing couldn't be used. Try again.".to_string(),
            }
        }
    }
}

/// Has the model draw `scene`, sending each piece to `updates`, then the
/// finished drawing. Stops as soon as nobody is listening, even while still
/// waiting for the model to be free.
async fn draw_and_report(
    brain: Arc<Brain>,
    scene: String,
    updates: UnboundedSender<DrawingUpdate>,
) {
    let pieces = updates.clone();
    let mut on_piece = move |text: &str| {
        let piece = DrawingUpdate::Piece {
            text: text.to_string(),
        };

        match pieces.send(piece) {
            Ok(()) => Listening::Go,
            Err(_) => Listening::Stop,
        }
    };

    let drawn = tokio::select! {
        drawn = brain.draw_cover(&scene, &mut on_piece) => drawn,
        () = updates.closed() => return,
    };

    // The page may have gone while the last piece was written.
    let _ = updates.send(finished_drawing(drawn));
}

/// `POST /api/cover-drawings`: has the model draw a scene as SVG, about a
/// minute and a half. The answer is lines of JSON: pieces of the drawing as
/// they are written, then the cleaned drawing or what went wrong. Ending the
/// request stops the model.
pub async fn cover_drawing(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    Json(request): Json<CoverDrawingRequest>,
) -> ApiResult<Response> {
    let brain = model(&state)?;
    let scene = bounded(
        &request.scene,
        LONGEST_SCENE,
        "the scene is too long; keep it under 2,500 characters",
    )?;
    if scene.chars().count() < SHORTEST_SCENE {
        return Err(ApiError::Invalid(
            "describe the scene in a sentence or more",
        ));
    }

    let (updates, received) = unbounded_channel();
    tokio::spawn(draw_and_report(brain, scene, updates));

    let headers = [
        (CONTENT_TYPE, "application/x-ndjson"),
        (CACHE_CONTROL, "no-store"),
    ];
    let body = Body::from_stream(UpdateLines { received });
    Ok((headers, body).into_response())
}
