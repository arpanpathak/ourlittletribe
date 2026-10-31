//! How failures become HTTP answers.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// A failure while handling a request.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// No valid session cookie.
    #[error("please sign in")]
    SignedOut,
    /// Signed in, but not allowed to do this.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The thing asked for does not exist.
    #[error("not found")]
    NotFound,
    /// The request was understood but its content is wrong.
    #[error("{0}")]
    Invalid(&'static str),
    /// The write would duplicate something unique.
    #[error("{0}")]
    Conflict(&'static str),
    /// Too many attempts in a short time.
    #[error("too many attempts, try again later")]
    TooMany,
    /// The model server is not configured on this instance.
    #[error("the planning model is not set up on this server")]
    NoModel,
    /// An outside service (map, weather, model) failed.
    #[error("{0}")]
    Upstream(String),
    /// Storage failed.
    #[error("storage error")]
    Database(tribe_db::DbError),
    /// Anything else unexpected.
    #[error("internal error")]
    Internal,
}

impl From<tribe_db::DbError> for ApiError {
    fn from(error: tribe_db::DbError) -> ApiError {
        match error {
            tribe_db::DbError::NotFound => ApiError::NotFound,
            tribe_db::DbError::AlreadyExists => ApiError::Conflict("already exists"),
            other => ApiError::Database(other),
        }
    }
}

impl From<tribe_places::PlacesError> for ApiError {
    fn from(error: tribe_places::PlacesError) -> ApiError {
        ApiError::Upstream(error.to_string())
    }
}

impl From<tribe_brain::BrainError> for ApiError {
    fn from(error: tribe_brain::BrainError) -> ApiError {
        ApiError::Upstream(error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            ApiError::SignedOut => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Invalid(_) => StatusCode::BAD_REQUEST,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooMany => StatusCode::TOO_MANY_REQUESTS,
            ApiError::NoModel => StatusCode::SERVICE_UNAVAILABLE,
            ApiError::Upstream(_) => StatusCode::BAD_GATEWAY,
            ApiError::Database(_) | ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        match &self {
            ApiError::Database(error) => tracing::error!(%error, "storage failure"),
            ApiError::Upstream(error) => tracing::warn!(%error, "outside service failure"),
            _ => {}
        }
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}

/// Shorthand for handler results.
pub type ApiResult<T> = Result<T, ApiError>;
