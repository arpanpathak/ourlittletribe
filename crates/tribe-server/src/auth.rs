//! Accounts and sessions: creating an account, signing in and out, and the
//! signed-in person of each request.
//!
//! Passwords are hashed with Argon2id. A session is a random 256-bit token in
//! an `HttpOnly`, `SameSite=Lax` cookie; the database keeps only its SHA-256,
//! so a copy of the database cannot be used to sign in.

use argon2::Argon2;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tribe_db::sessions::TokenHash;
use tribe_db::users::User;
use tribe_db::{DbError, sessions, unix_now, users};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// Name of the session cookie.
pub const SESSION_COOKIE: &str = "olt_session";

/// How long a session lasts: 30 days.
const SESSION_SECONDS: i64 = 30 * 24 * 3600;

/// The shortest password allowed.
const MIN_PASSWORD_CHARS: usize = 10;

/// An email address that has the shape of one, lower-cased.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email(String);

impl Email {
    /// The address, trimmed and lower-cased, if it looks like one.
    pub fn parse(text: &str) -> ApiResult<Email> {
        let email = text.trim().to_lowercase();
        let Some((local, domain)) = email.split_once('@') else {
            return Err(ApiError::Invalid("enter a valid email"));
        };

        let well_formed =
            !local.is_empty() && domain.contains('.') && !email.contains(char::is_whitespace);
        match well_formed && email.len() <= 200 {
            true => Ok(Email(email)),
            false => Err(ApiError::Invalid("enter a valid email")),
        }
    }
}

/// A password for a new account: at least ten characters.
pub struct NewPassword(String);

impl NewPassword {
    /// The password, if it is long enough and not absurdly long.
    pub fn parse(text: String) -> ApiResult<NewPassword> {
        let long_enough = text.chars().count() >= MIN_PASSWORD_CHARS;
        match long_enough && text.len() <= 200 {
            true => Ok(NewPassword(text)),
            false => Err(ApiError::Invalid(
                "use a password of at least 10 characters",
            )),
        }
    }

    /// The Argon2id hash of the password, with a fresh salt.
    fn hash(&self) -> ApiResult<String> {
        let salt = SaltString::generate(&mut OsRng);
        let hashed = Argon2::default().hash_password(self.0.as_bytes(), &salt);
        hashed
            .map(|hash| hash.to_string())
            .map_err(|_| ApiError::Internal)
    }
}

/// Whether `password` matches the stored Argon2 `hash`.
fn password_matches(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// A session token as the browser holds it.
pub struct SessionToken(String);

impl SessionToken {
    fn random() -> SessionToken {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        SessionToken(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }

    /// The token from the request's cookies, if it has one.
    fn from_headers(headers: &HeaderMap) -> Option<SessionToken> {
        let cookie_text = headers
            .get_all(COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok());
        let pairs = cookie_text
            .flat_map(|text| text.split(';'))
            .filter_map(|pair| pair.trim().split_once('='));

        pairs
            .filter(|(name, value)| *name == SESSION_COOKIE && !value.is_empty())
            .map(|(_, value)| SessionToken(value.to_string()))
            .next()
    }

    /// The SHA-256 of the token, as hex: the only form the database keeps.
    fn hash(&self) -> TokenHash {
        let digest = Sha256::digest(self.0.as_bytes());
        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        TokenHash(hex)
    }
}

/// The `Set-Cookie` header that stores `value` for `max_age` seconds; 0 removes it.
fn session_cookie(value: &str, max_age: i64, secure: bool) -> ApiResult<HeaderValue> {
    let secure_flag = match secure {
        true => "; Secure",
        false => "",
    };
    let cookie = format!(
        "{SESSION_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_flag}"
    );
    HeaderValue::from_str(&cookie).map_err(|_| ApiError::Internal)
}

/// The signed-in person of a request. Handlers that take it answer 401 to signed-out requests.
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<CurrentUser, ApiError> {
        let token = SessionToken::from_headers(&parts.headers).ok_or(ApiError::SignedOut)?;
        let hash = token.hash();

        let user = state
            .db
            .call(move |connection| sessions::user_for(connection, &hash, unix_now()))
            .await?;
        user.map(CurrentUser).ok_or(ApiError::SignedOut)
    }
}

/// Starts a session for `user` and answers `201 Created` with the user and the cookie.
async fn start_session(state: &AppState, user: User) -> ApiResult<Response> {
    let token = SessionToken::random();
    let hash = token.hash();
    let user_id = user.id.clone();

    state
        .db
        .call(move |connection| {
            sessions::create(connection, &hash, &user_id, unix_now() + SESSION_SECONDS)
        })
        .await?;

    let cookie = session_cookie(&token.0, SESSION_SECONDS, state.config.secure_cookie)?;
    let mut response = (StatusCode::CREATED, Json(user)).into_response();
    response.headers_mut().insert(SET_COOKIE, cookie);
    Ok(response)
}

/// Body of `POST /api/users`.
#[derive(Deserialize)]
pub struct NewAccount {
    /// Sign-in email.
    email: String,
    /// Display name.
    name: String,
    /// At least ten characters.
    password: String,
}

/// `POST /api/users`: creates an account and signs it in.
pub async fn create_account(
    State(state): State<AppState>,
    Json(account): Json<NewAccount>,
) -> ApiResult<Response> {
    let email = Email::parse(&account.email)?;
    let name = account.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(ApiError::Invalid("enter a name of up to 60 characters"));
    }
    let password = NewPassword::parse(account.password)?;
    if !state.limits.sign_ups.allow() {
        return Err(ApiError::TooMany);
    }

    let hash = tokio::task::spawn_blocking(move || password.hash())
        .await
        .map_err(|_| ApiError::Internal)??;
    let created = state
        .db
        .call(move |connection| users::create(connection, &email.0, &name, &hash))
        .await;

    let user = match created {
        Ok(user) => user,
        Err(DbError::AlreadyExists) => {
            return Err(ApiError::Conflict("that email already has an account"));
        }
        Err(other) => return Err(other.into()),
    };
    start_session(&state, user).await
}

/// Body of `POST /api/sessions`.
#[derive(Deserialize)]
pub struct SignIn {
    /// Sign-in email.
    email: String,
    /// The account's password.
    password: String,
}

/// `POST /api/sessions`: signs in with email and password.
pub async fn sign_in(
    State(state): State<AppState>,
    Json(sign_in): Json<SignIn>,
) -> ApiResult<Response> {
    let email = sign_in.email.trim().to_lowercase();
    let found = state
        .db
        .call(move |connection| users::credentials(connection, &email))
        .await?;

    let password = sign_in.password;
    let verified = tokio::task::spawn_blocking(move || {
        found
            .filter(|credentials| password_matches(&password, &credentials.password_hash))
            .map(|credentials| credentials.user)
    })
    .await
    .map_err(|_| ApiError::Internal)?;

    match (verified, state.limits.failed_sign_ins.allow()) {
        (Some(user), _) => start_session(&state, user).await,
        (None, true) => Err(ApiError::WrongPassword),
        (None, false) => Err(ApiError::TooMany),
    }
}

/// `DELETE /api/sessions/current`: signs out, ending the session and removing the cookie.
pub async fn sign_out(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(token) = SessionToken::from_headers(&headers) {
        let hash = token.hash();
        state
            .db
            .call(move |connection| sessions::delete(connection, &hash))
            .await?;
    }

    let cookie = session_cookie("", 0, state.config.secure_cookie)?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(SET_COOKIE, cookie);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_matches_only_its_own_hash() -> ApiResult<()> {
        let hash = NewPassword::parse("correct horse battery".to_string())?.hash()?;

        assert!(password_matches("correct horse battery", &hash));
        assert!(!password_matches("wrong horse", &hash));
        assert!(!password_matches("anything", "not-a-hash"));
        Ok(())
    }

    #[test]
    fn short_passwords_are_refused() {
        assert!(NewPassword::parse("too short".to_string()).is_err());
    }

    #[test]
    fn the_session_cookie_is_found_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_static("theme=dark; olt_session=abc123; other=1"),
        );

        let Some(token) = SessionToken::from_headers(&headers) else {
            panic!("no token");
        };
        assert_eq!(token.0, "abc123");
    }

    #[test]
    fn the_stored_hash_is_hex_sha256() {
        let hash = SessionToken("abc".to_string()).hash();
        assert_eq!(
            hash.0,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn emails_are_checked_and_lower_cased() -> ApiResult<()> {
        assert_eq!(
            Email::parse(" Ada@Example.com ")?,
            Email("ada@example.com".to_string())
        );
        assert!(Email::parse("ada@example").is_err());
        assert!(Email::parse("ada example@x.com").is_err());
        Ok(())
    }
}
