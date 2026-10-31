//! Settings read at start-up, and the state every request shares: storage,
//! the outside services, rate limits and short-lived caches.

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;
use tribe_brain::Brain;
use tribe_brain::briefing::{Briefing, Units};
use tribe_core::geo::LatLng;
use tribe_db::Db;
use tribe_db::ids::EventId;
use tribe_db::stores::Store;
use tribe_media::MediaStore;
use tribe_places::Places;
use tribe_places::address::PlaceMatch;
use tribe_places::photon::Area;

use crate::conditions::Conditions;

/// Settings, from `OLT_*` environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// `OLT_ADDR`: where to listen. Default `127.0.0.1:8090`.
    pub listen: SocketAddr,
    /// `OLT_DB`: the SQLite file. Default `ourlittletribe.db`.
    pub database: PathBuf,
    /// `OLT_MEDIA`: the folder for uploaded pictures. Default: `media` next to the database.
    pub media: PathBuf,
    /// `OLT_LLM_URL`: OpenAI-style base URL ending in `/v1`. Unset turns the model off.
    pub llm_url: Option<String>,
    /// `OLT_LLM_MODEL`: model id; unset uses the first one the server lists.
    pub llm_model: Option<String>,
    /// `OLT_LLM_KEY`: bearer key for the model server, if it needs one.
    pub llm_key: Option<String>,
    /// False when `OLT_INSECURE_COOKIE` is set, for plain-HTTP testing on a LAN.
    pub secure_cookie: bool,
}

fn non_empty_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

impl Config {
    /// Reads the settings from the environment.
    pub fn from_env() -> anyhow::Result<Config> {
        let listen = non_empty_var("OLT_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8090".to_string())
            .parse()?;
        let database = PathBuf::from(
            non_empty_var("OLT_DB").unwrap_or_else(|| "ourlittletribe.db".to_string()),
        );

        let media = match (non_empty_var("OLT_MEDIA"), database.parent()) {
            (Some(folder), _) => PathBuf::from(folder),
            (None, Some(parent)) => parent.join("media"),
            (None, None) => PathBuf::from("media"),
        };

        Ok(Config {
            listen,
            database,
            media,
            llm_url: non_empty_var("OLT_LLM_URL").map(|url| url.trim_end_matches('/').to_string()),
            llm_model: non_empty_var("OLT_LLM_MODEL"),
            llm_key: non_empty_var("OLT_LLM_KEY"),
            secure_cookie: non_empty_var("OLT_INSECURE_COOKIE").is_none(),
        })
    }
}

/// Allows at most `limit` events per `window`, across the whole server.
pub struct RateLimit {
    /// Most events in one window.
    limit: usize,
    /// How far back events count.
    window: Duration,
    /// When recent events happened, oldest first.
    recent: Mutex<VecDeque<Instant>>,
}

impl RateLimit {
    /// A limit of `limit` events per `window`.
    pub fn new(limit: usize, window: Duration) -> RateLimit {
        RateLimit {
            limit,
            window,
            recent: Mutex::new(VecDeque::new()),
        }
    }

    /// Records one event, and says whether it is within the limit.
    pub fn allow(&self) -> bool {
        let Ok(mut recent) = self.recent.lock() else {
            return false;
        };

        let now = Instant::now();
        recent.retain(|happened| now.duration_since(*happened) <= self.window);
        if recent.len() >= self.limit {
            return false;
        }

        recent.push_back(now);
        true
    }
}

/// The server-wide limits.
pub struct Limits {
    /// New accounts: 30 an hour.
    pub sign_ups: RateLimit,
    /// Failed sign-ins: 60 in 10 minutes.
    pub failed_sign_ins: RateLimit,
    /// Picture uploads: 300 an hour.
    pub uploads: RateLimit,
}

impl Limits {
    /// The limits the server runs with.
    pub fn standard() -> Limits {
        Limits {
            sign_ups: RateLimit::new(30, Duration::from_secs(3600)),
            failed_sign_ins: RateLimit::new(60, Duration::from_secs(600)),
            uploads: RateLimit::new(300, Duration::from_secs(3600)),
        }
    }
}

/// A small cache whose entries expire after a fixed time.
pub struct TimedCache<Key, Value> {
    /// How long an entry stays fresh.
    lifetime: Duration,
    /// Each entry with when it was stored.
    entries: Mutex<HashMap<Key, (Instant, Value)>>,
}

impl<Key: Eq + Hash, Value: Clone> TimedCache<Key, Value> {
    /// A cache whose entries last `lifetime`.
    pub fn new(lifetime: Duration) -> TimedCache<Key, Value> {
        TimedCache {
            lifetime,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// The value stored under `key`, if it is still fresh.
    pub fn get(&self, key: &Key) -> Option<Value> {
        let entries = self.entries.lock().ok()?;
        let (stored_at, value) = entries.get(key)?;
        (stored_at.elapsed() < self.lifetime).then(|| value.clone())
    }

    /// Drops the entry for `key`, if any.
    pub fn forget(&self, key: &Key) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(key);
        }
    }

    /// Stores `value` under `key`, dropping stale entries.
    pub fn put(&self, key: Key, value: Value) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        entries.retain(|_, (stored_at, _)| stored_at.elapsed() < self.lifetime);
        entries.insert(key, (Instant::now(), value));
    }
}

/// A pause that starts after a failure, during which a busy service is not asked.
pub struct Cooldown {
    /// How long a pause lasts.
    length: Duration,
    /// When the current pause started, if one has.
    started: Mutex<Option<Instant>>,
}

impl Cooldown {
    /// A cooldown whose pauses last `length`.
    pub fn new(length: Duration) -> Cooldown {
        Cooldown {
            length,
            started: Mutex::new(None),
        }
    }

    /// Starts a pause now.
    pub fn start(&self) {
        if let Ok(mut started) = self.started.lock() {
            *started = Some(Instant::now());
        }
    }

    /// Whether a pause is still running.
    pub fn is_active(&self) -> bool {
        let Ok(started) = self.started.lock() else {
            return false;
        };
        started.is_some_and(|began| began.elapsed() < self.length)
    }
}

/// A position rounded to a tenth of a degree (about 10 km), for caching
/// answers that do not change across a town.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RoughSpot {
    /// Latitude in tenths of a degree.
    lat_tenths: i32,
    /// Longitude in tenths of a degree.
    lng_tenths: i32,
}

impl RoughSpot {
    /// The rough spot holding `point`.
    pub fn of(point: LatLng) -> RoughSpot {
        RoughSpot {
            lat_tenths: (point.lat * 10.0).round() as i32,
            lng_tenths: (point.lng * 10.0).round() as i32,
        }
    }
}

/// A briefing is written per event and per unit system.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BriefingKey {
    /// The event.
    pub event_id: EventId,
    /// The units it is written in.
    pub units: Units,
}

/// A place search, by its lower-cased text and roughly where it was made.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SearchKey {
    /// The search, lower-cased.
    pub text: String,
    /// Where the person was, roughly.
    pub near: Option<RoughSpot>,
}

/// Answers from outside services, kept for a while.
pub struct Caches {
    /// Forecast and elevation per event, 30 minutes.
    pub conditions: TimedCache<EventId, Conditions>,
    /// The model's briefing per event and units, an hour.
    pub briefings: TimedCache<BriefingKey, Briefing>,
    /// Stores found per route and set of shop kinds, 30 minutes.
    pub store_lookups: TimedCache<String, Vec<Store>>,
    /// After Overpass fails, three minutes of using remembered stores only.
    pub store_search_cooldown: Cooldown,
    /// The model's best matches per place search, 30 minutes.
    pub best_matches: TimedCache<SearchKey, Vec<PlaceMatch>>,
    /// Areas named in the model's guesses, by lower-cased name, a day.
    pub areas: TimedCache<String, Option<Area>>,
    /// The region around a rough spot, such as "Seattle, Washington", a day.
    pub regions: TimedCache<RoughSpot, String>,
}

impl Caches {
    /// Empty caches with the lifetimes above.
    pub fn new() -> Caches {
        let minutes = |count: u64| Duration::from_secs(count * 60);
        Caches {
            conditions: TimedCache::new(minutes(30)),
            briefings: TimedCache::new(minutes(60)),
            store_lookups: TimedCache::new(minutes(30)),
            store_search_cooldown: Cooldown::new(minutes(3)),
            best_matches: TimedCache::new(minutes(30)),
            areas: TimedCache::new(minutes(24 * 60)),
            regions: TimedCache::new(minutes(24 * 60)),
        }
    }

    /// Forgets everything worked out for an event, after it changes.
    pub fn forget_event(&self, event_id: &EventId) {
        self.conditions.forget(event_id);
        for units in [Units::Imperial, Units::Metric] {
            self.briefings.forget(&BriefingKey {
                event_id: event_id.clone(),
                units,
            });
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
    /// The model, when configured.
    pub brain: Option<Arc<Brain>>,
    /// Settings.
    pub config: Arc<Config>,
    /// Server-wide rate limits.
    pub limits: Arc<Limits>,
    /// Short-lived answers from outside services.
    pub caches: Arc<Caches>,
    /// Uploaded pictures on disk.
    pub media: Arc<MediaStore>,
    /// How many pictures may be decoded at once; each can take a few hundred MB.
    pub picture_jobs: Arc<Semaphore>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rate_limit_stops_after_the_limit() {
        let limit = RateLimit::new(2, Duration::from_secs(60));
        assert!(limit.allow());
        assert!(limit.allow());
        assert!(!limit.allow());
    }

    #[test]
    fn a_cache_returns_fresh_values_only() {
        let cache = TimedCache::new(Duration::from_secs(60));
        cache.put("key", 7);
        assert_eq!(cache.get(&"key"), Some(7));
        assert_eq!(cache.get(&"other"), None);

        let expired = TimedCache::new(Duration::ZERO);
        expired.put("key", 7);
        assert_eq!(expired.get(&"key"), None);
    }

    #[test]
    fn a_cooldown_runs_only_after_it_starts() {
        let cooldown = Cooldown::new(Duration::from_secs(60));
        assert!(!cooldown.is_active());
        cooldown.start();
        assert!(cooldown.is_active());
    }

    #[test]
    fn nearby_points_share_a_rough_spot() {
        let pike_place = RoughSpot::of(LatLng {
            lat: 47.609,
            lng: -122.342,
        });
        let pioneer_square = RoughSpot::of(LatLng {
            lat: 47.601,
            lng: -122.334,
        });
        let tacoma = RoughSpot::of(LatLng {
            lat: 47.25,
            lng: -122.44,
        });
        assert_eq!(pike_place, pioneer_square);
        assert_ne!(pike_place, tacoma);
    }
}
