//! Accounts: sign up, sign in, sign out, and the signed-in user of a request.
//!
//! Passwords are hashed with Argon2id. A session is a random 256-bit token
//! in an `HttpOnly`, `SameSite=Lax` cookie; the database keeps only its
//! SHA-256, so a copy of the database cannot be used to sign in.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{FromRequestParts, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tribe_db::users::User;
use tribe_db::{sessions, unix_now, users};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Name of the session cookie.
pub const SESSION_COOKIE: &str = "olt_session";

const SESSION_SECONDS: i64 = 30 * 24 * 3600;

/// Hashes a password with Argon2id and a fresh salt.
pub fn hash_password(password: &str) -> ApiResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::Internal)
}

/// Whether `password` matches the stored Argon2 `hash`.
pub fn password_matches(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

fn new_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    for header in headers.get_all(COOKIE) {
        let Ok(text) = header.to_str() else {
            continue;
        };
        for pair in text.split(';') {
            if let Some((name, value)) = pair.trim().split_once('=')
                && name == SESSION_COOKIE
                && !value.is_empty()
            {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn session_cookie(value: &str, max_age: i64, secure: bool) -> ApiResult<HeaderValue> {
    let secure_flag = match secure {
        true => "; Secure",
        false => "",
    };
    let cookie = format!("{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_flag}");
    HeaderValue::from_str(&cookie).map_err(|_| ApiError::Internal)
}

/// The signed-in user of a request. Handlers that take it answer 401 to signed-out requests.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<CurrentUser, ApiError> {
        let token = session_token(&parts.headers).ok_or(ApiError::SignedOut)?;
        let hash = token_hash(&token);
        let user = state
            .db
            .call(move |connection| sessions::user_for(connection, &hash, unix_now()))
            .await?;
        user.map(CurrentUser).ok_or(ApiError::SignedOut)
    }
}

/// Body of a sign-up.
#[derive(Deserialize)]
pub struct SignUp {
    email: String,
    name: String,
    password: String,
}

/// Body of a sign-in.
#[derive(Deserialize)]
pub struct SignIn {
    email: String,
    password: String,
}

fn looks_like_email(email: &str) -> bool {
    match email.split_once('@') {
        Some((local, domain)) => !local.is_empty() && domain.contains('.') && !email.contains(char::is_whitespace),
        None => false,
    }
}

async fn start_session(state: &AppState, user: User) -> ApiResult<Response> {
    let token = new_session_token();
    let hash = token_hash(&token);
    let user_id = user.id.clone();
    state
        .db
        .call(move |connection| sessions::create(connection, &hash, &user_id, unix_now() + SESSION_SECONDS))
        .await?;
    let cookie = session_cookie(&token, SESSION_SECONDS, state.config.secure_cookie)?;
    let mut response = Json(user).into_response();
    response.headers_mut().insert(SET_COOKIE, cookie);
    Ok(response)
}

/// `POST /api/account/register`: makes an account and signs it in.
pub async fn register(State(state): State<AppState>, Json(body): Json<SignUp>) -> ApiResult<Response> {
    let email = body.email.trim().to_lowercase();
    let name = body.name.trim().to_string();
    if !looks_like_email(&email) || email.len() > 200 {
        return Err(ApiError::Invalid("enter a valid email"));
    }
    if name.is_empty() || name.chars().count() > 60 {
        return Err(ApiError::Invalid("enter a name of up to 60 characters"));
    }
    if body.password.chars().count() < 10 || body.password.len() > 200 {
        return Err(ApiError::Invalid("use a password of at least 10 characters"));
    }
    if !state.sign_ups.allow() {
        return Err(ApiError::TooMany);
    }
    let password = body.password;
    let hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(|_| ApiError::Internal)??;
    let user = state
        .db
        .call(move |connection| users::create(connection, &email, &name, &hash))
        .await
        .map_err(|error| match error {
            tribe_db::DbError::AlreadyExists => ApiError::Conflict("that email already has an account"),
            other => ApiError::from(other),
        })?;
    start_session(&state, user).await
}

/// `POST /api/account/login`: signs in with email and password.
pub async fn login(State(state): State<AppState>, Json(body): Json<SignIn>) -> ApiResult<Response> {
    let email = body.email.trim().to_lowercase();
    let found = state
        .db
        .call(move |connection| users::find_for_sign_in(connection, &email))
        .await?;
    let password = body.password;
    let verified = tokio::task::spawn_blocking(move || match found {
        Some((user, hash)) if password_matches(&password, &hash) => Some(user),
        _ => None,
    })
    .await
    .map_err(|_| ApiError::Internal)?;
    match verified {
        Some(user) => start_session(&state, user).await,
        None => match state.failed_sign_ins.allow() {
            true => Err(ApiError::Forbidden("wrong email or password")),
            false => Err(ApiError::TooMany),
        },
    }
}

/// `POST /api/account/logout`: ends the session.
pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(token) = session_token(&headers) {
        let hash = token_hash(&token);
        state.db.call(move |connection| sessions::delete(connection, &hash)).await?;
    }
    let cookie = session_cookie("", 0, state.config.secure_cookie)?;
    let mut response = Json(serde_json::json!({ "status": "signed_out" })).into_response();
    response.headers_mut().insert(SET_COOKIE, cookie);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_round_trip() -> ApiResult<()> {
        let hash = hash_password("correct horse battery")?;
        assert!(password_matches("correct horse battery", &hash));
        assert!(!password_matches("wrong horse", &hash));
        assert!(!password_matches("anything", "not-a-hash"));
        Ok(())
    }

    #[test]
    fn session_cookie_is_found_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_static("theme=dark; olt_session=abc123; other=1"));
        assert_eq!(session_token(&headers), Some("abc123".to_string()));
    }

    #[test]
    fn token_hash_is_hex_sha256() {
        let hash = token_hash("abc");
        assert_eq!(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn email_shape_is_checked() {
        assert!(looks_like_email("ada@example.com"));
        assert!(!looks_like_email("ada@example"));
        assert!(!looks_like_email("ada example@x.com"));
    }
}
