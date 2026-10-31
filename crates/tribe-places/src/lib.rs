//! Clients for the open services the app reads the real world from.
//!
//! | Service | Used for |
//! |---|---|
//! | Open-Meteo | the forecast and elevation at the meeting point |
//! | OSRM | the driving route and each store's detour time |
//! | Overpass (OpenStreetMap) | stores near the route |
//! | Nominatim (OpenStreetMap) | place search |
//!
//! All four are free and need no key. Each base URL can be changed, so an
//! instance can use its own copies.

pub mod nominatim;
pub mod osrm;
pub mod overpass;
pub mod weather;

use std::time::Duration;

/// Everything that can go wrong talking to a service.
#[derive(Debug, thiserror::Error)]
pub enum PlacesError {
    /// The request failed or the body was not the JSON expected.
    #[error("{service}: {source}")]
    Http {
        /// Which service.
        service: &'static str,
        /// What went wrong.
        source: reqwest::Error,
    },
    /// The service answered, but said it could not help.
    #[error("{service} answered: {reason}")]
    Refused {
        /// Which service.
        service: &'static str,
        /// The reason it gave, or the HTTP status.
        reason: String,
    },
}

/// Base URLs of the services.
#[derive(Debug, Clone)]
pub struct Endpoints {
    /// Open-Meteo forecast API.
    pub open_meteo: String,
    /// Open-Meteo elevation API.
    pub open_meteo_elevation: String,
    /// OSRM, without a trailing slash.
    pub osrm: String,
    /// Overpass interpreter.
    pub overpass: String,
    /// Nominatim, without a trailing slash.
    pub nominatim: String,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints {
            open_meteo: "https://api.open-meteo.com/v1/forecast".to_string(),
            open_meteo_elevation: "https://api.open-meteo.com/v1/elevation".to_string(),
            osrm: "https://router.project-osrm.org".to_string(),
            overpass: "https://overpass-api.de/api/interpreter".to_string(),
            nominatim: "https://nominatim.openstreetmap.org".to_string(),
        }
    }
}

/// A shared client for all four services.
#[derive(Debug, Clone)]
pub struct Places {
    http: reqwest::Client,
    endpoints: Endpoints,
}

impl Places {
    /// Builds a client that identifies itself as `user_agent`, as Nominatim's and Overpass's usage policies ask.
    pub fn new(user_agent: &str, endpoints: Endpoints) -> Result<Places, PlacesError> {
        let http = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_secs(40))
            .build()
            .map_err(|source| PlacesError::Http { service: "http client", source })?;
        Ok(Places { http, endpoints })
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        service: &'static str,
        request: reqwest::RequestBuilder,
    ) -> Result<T, PlacesError> {
        let response = request
            .send()
            .await
            .map_err(|source| PlacesError::Http { service, source })?;
        let status = response.status();
        if !status.is_success() {
            return Err(PlacesError::Refused {
                service,
                reason: status.to_string(),
            });
        }
        response
            .json::<T>()
            .await
            .map_err(|source| PlacesError::Http { service, source })
    }
}
