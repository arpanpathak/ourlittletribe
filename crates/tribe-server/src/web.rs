//! The web app, built into the binary so one file is the whole deployment.

use axum::http::header::{
    CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS,
    X_FRAME_OPTIONS,
};
use axum::http::{HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};

macro_rules! web_file {
    ($path:literal) => {
        (
            $path,
            include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/", $path)).as_slice(),
        )
    };
}

const FILES: &[(&str, &[u8])] = &[
    web_file!("app.css"),
    web_file!("favicon.svg"),
    web_file!("index.html"),
    web_file!("js/api.js"),
    web_file!("js/app.js"),
    web_file!("js/art.js"),
    web_file!("js/icons.js"),
    web_file!("js/map.js"),
    web_file!("js/markdown.js"),
    web_file!("js/stops.js"),
    web_file!("js/theme.js"),
    web_file!("js/ui.js"),
    web_file!("js/components/cards.js"),
    web_file!("js/components/locations_editor.js"),
    web_file!("js/components/markdown_editor.js"),
    web_file!("js/components/picture_picker.js"),
    web_file!("js/components/place_search.js"),
    web_file!("js/views/auth.js"),
    web_file!("js/views/event.js"),
    web_file!("js/views/event_form.js"),
    web_file!("js/views/explore.js"),
    web_file!("js/views/feed.js"),
    web_file!("js/views/profile.js"),
    web_file!("js/views/search.js"),
    web_file!("js/views/tribe.js"),
    web_file!("js/views/tribe_form.js"),
    web_file!("js/views/tribes.js"),
    web_file!("vendor/fonts/inter-latin-wght-normal.woff2"),
    web_file!("vendor/images/layers-2x.png"),
    web_file!("vendor/images/layers.png"),
    web_file!("vendor/leaflet.css"),
    web_file!("vendor/leaflet.js"),
];

const POLICY: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob: https://*.tile.opentopomap.org https://tile.openstreetmap.org; \
connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn find(path: &str) -> Option<(&'static str, &'static [u8])> {
    FILES
        .iter()
        .find(|(name, _)| *name == path)
        .map(|(name, bytes)| (*name, *bytes))
}

/// Serves a file of the web app; any other path outside `/api` gets the app's page.
pub async fn serve(uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    if requested.starts_with("api/") {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({ "error": "not found" })),
        )
            .into_response();
    }
    let (name, bytes) = match find(requested) {
        Some(found) => found,
        None => match requested.contains('.') {
            true => return StatusCode::NOT_FOUND.into_response(),
            false => match find("index.html") {
                Some(page) => page,
                None => return StatusCode::NOT_FOUND.into_response(),
            },
        },
    };
    let cache = match name {
        "index.html" => "no-cache",
        _ if name.starts_with("vendor/") => "public, max-age=604800",
        _ => "no-cache",
    };
    let mut response = bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(content_type(name)));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache));
    headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(POLICY));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_file_has_a_known_type() {
        for (name, bytes) in FILES {
            assert_ne!(content_type(name), "application/octet-stream", "{name}");
            assert!(!bytes.is_empty(), "{name} is empty");
        }
    }
}
