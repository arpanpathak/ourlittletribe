//! Clients for the open services the app reads the real world from.
//!
//! | Service | Used for |
//! |---|---|
//! | Open-Meteo | the forecast and elevation at the meeting point |
//! | OSRM | the driving route and each store's detour time |
//! | Overpass (OpenStreetMap) | stores near the route |
//! | Photon (OpenStreetMap) | place search and naming a point on the map |
//! | Nominatim (OpenStreetMap) | the same, when Photon is down or refuses |
//!
//! All are free and need no key. Each base URL can be changed, so an
//! instance can use its own copies.

pub mod address;
pub mod nominatim;
pub mod osrm;
pub mod overpass;
pub mod photon;
pub mod shops;
pub mod trails;
mod waymarked;
pub mod weather;

use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, Semaphore};

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
    /// Overpass interpreters, tried in order until one answers. The public ones are often busy.
    pub overpass: Vec<String>,
    /// Photon geocoder, without a trailing slash.
    pub photon: String,
    /// Nominatim geocoder, without a trailing slash; used when Photon fails.
    pub nominatim: String,
    /// Waymarked Trails' hiking API, without a trailing slash: marked routes in walking order.
    pub waymarked: String,
}

impl Default for Endpoints {
    fn default() -> Endpoints {
        Endpoints {
            open_meteo: "https://api.open-meteo.com/v1/forecast".to_string(),
            open_meteo_elevation: "https://api.open-meteo.com/v1/elevation".to_string(),
            osrm: "https://router.project-osrm.org".to_string(),
            overpass: vec![
                "https://overpass-api.de/api/interpreter".to_string(),
                "https://overpass.private.coffee/api/interpreter".to_string(),
            ],
            photon: "https://photon.komoot.io".to_string(),
            nominatim: "https://nominatim.openstreetmap.org".to_string(),
            waymarked: "https://hiking.waymarkedtrails.org/api/v1".to_string(),
        }
    }
}

/// Photon requests allowed at once, to stay a polite user of the public server.
const PHOTON_AT_ONCE: usize = 3;
/// Nominatim's usage policy allows one request a second.
const NOMINATIM_SPACING: Duration = Duration::from_millis(1100);

/// A shared client for all the services.
#[derive(Debug, Clone)]
pub struct Places {
    http: reqwest::Client,
    endpoints: Endpoints,
    photon_slots: Arc<Semaphore>,
    /// Until when (Unix seconds) Photon is skipped after it failed.
    photon_resting_until: Arc<AtomicU64>,
    /// When the last Nominatim request was sent; held while one is in flight.
    nominatim_turn: Arc<Mutex<Option<Instant>>>,
}

impl Places {
    /// Builds a client that identifies itself as `user_agent`, as the services' usage policies ask.
    pub fn new(user_agent: &str, endpoints: Endpoints) -> Result<Places, PlacesError> {
        let http = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_secs(40))
            .build()
            .map_err(|source| PlacesError::Http {
                service: "http client",
                source,
            })?;
        Ok(Places {
            http,
            endpoints,
            photon_slots: Arc::new(Semaphore::new(PHOTON_AT_ONCE)),
            photon_resting_until: Arc::new(AtomicU64::new(0)),
            nominatim_turn: Arc::new(Mutex::new(None)),
        })
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
