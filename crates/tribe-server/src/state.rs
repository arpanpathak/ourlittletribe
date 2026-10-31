//! Settings read at start-up and the state every request shares.

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tribe_brain::Brain;
use tribe_db::Db;
use tribe_places::Places;

/// Settings, from environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// `OLT_ADDR`: where to listen. Default `127.0.0.1:8090`.
    pub listen: SocketAddr,
    /// `OLT_DB`: the SQLite file. Default `ourlittletribe.db`.
    pub database: PathBuf,
    /// `OLT_LLM_URL`: OpenAI-style base URL ending in `/v1`. Unset turns planning off.
    pub llm_url: Option<String>,
    /// `OLT_LLM_MODEL`: model id; unset uses the first one the server lists.
    pub llm_model: Option<String>,
    /// `OLT_LLM_KEY`: bearer key for the model server, if it needs one.
    pub llm_key: Option<String>,
    /// `OLT_INSECURE_COOKIE=1` drops the `Secure` cookie flag, for plain-HTTP testing on a LAN.
    pub secure_cookie: bool,
}

fn non_empty_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}

impl Config {
    /// Reads the settings from the environment.
    pub fn from_env() -> anyhow::Result<Config> {
        let listen = non_empty_var("OLT_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8090".to_string())
            .parse()?;
        Ok(Config {
            listen,
            database: non_empty_var("OLT_DB").unwrap_or_else(|| "ourlittletribe.db".to_string()).into(),
            llm_url: non_empty_var("OLT_LLM_URL").map(|url| url.trim_end_matches('/').to_string()),
            llm_model: non_empty_var("OLT_LLM_MODEL"),
            llm_key: non_empty_var("OLT_LLM_KEY"),
            secure_cookie: non_empty_var("OLT_INSECURE_COOKIE").is_none(),
        })
    }
}

/// Allows at most `limit` events per `window`, across the whole server.
pub struct RateLimit {
    limit: usize,
    window: Duration,
    recent: Mutex<VecDeque<Instant>>,
}

impl RateLimit {
    /// A limit of `limit` per `window`.
    pub fn new(limit: usize, window: Duration) -> RateLimit {
        RateLimit {
            limit,
            window,
            recent: Mutex::new(VecDeque::new()),
        }
    }

    /// Records one event and says whether it is within the limit.
    pub fn allow(&self) -> bool {
        let Ok(mut recent) = self.recent.lock() else {
            return false;
        };
        let now = Instant::now();
        while let Some(oldest) = recent.front() {
            match now.duration_since(*oldest) > self.window {
                true => {
                    recent.pop_front();
                }
                false => break,
            }
        }
        match recent.len() < self.limit {
            true => {
                recent.push_back(now);
                true
            }
            false => false,
        }
    }
}

/// A small time-limited cache for answers from outside services.
pub struct TimedCache<T: Clone> {
    lifetime: Duration,
    entries: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T: Clone> TimedCache<T> {
    /// A cache whose entries last `lifetime`.
    pub fn new(lifetime: Duration) -> TimedCache<T> {
        TimedCache {
            lifetime,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// The cached value for `key`, if it is still fresh.
    pub fn get(&self, key: &str) -> Option<T> {
        let entries = self.entries.lock().ok()?;
        let (stored_at, value) = entries.get(key)?;
        match stored_at.elapsed() < self.lifetime {
            true => Some(value.clone()),
            false => None,
        }
    }

    /// Stores `value` under `key`, dropping stale entries.
    pub fn put(&self, key: String, value: T) {
        if let Ok(mut entries) = self.entries.lock() {
            let lifetime = self.lifetime;
            entries.retain(|_, (stored_at, _)| stored_at.elapsed() < lifetime);
            entries.insert(key, (Instant::now(), value));
        }
    }
}

/// What every handler can reach.
#[derive(Clone)]
pub struct AppState {
    /// Storage.
    pub db: Db,
    /// Map and weather services.
    pub places: Places,
    /// The planning model, when configured.
    pub brain: Option<Arc<Brain>>,
    /// Settings.
    pub config: Arc<Config>,
    /// Limit on new accounts.
    pub sign_ups: Arc<RateLimit>,
    /// Limit on failed sign-ins.
    pub failed_sign_ins: Arc<RateLimit>,
    /// Recent conditions (forecast and elevation) per event.
    pub conditions: Arc<TimedCache<crate::trip::Conditions>>,
    /// Recent store lookups per route and tag set.
    pub store_lookups: Arc<TimedCache<Vec<tribe_db::stores::Store>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_stops_after_the_limit() {
        let limit = RateLimit::new(2, Duration::from_secs(60));
        assert!(limit.allow());
        assert!(limit.allow());
        assert!(!limit.allow());
    }

    #[test]
    fn cache_returns_fresh_values_only() {
        let cache = TimedCache::new(Duration::from_secs(60));
        cache.put("key".to_string(), 7);
        assert_eq!(cache.get("key"), Some(7));
        assert_eq!(cache.get("other"), None);
        let expired = TimedCache::new(Duration::ZERO);
        expired.put("key".to_string(), 7);
        assert_eq!(expired.get("key"), None);
    }
}
