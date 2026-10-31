//! OurLittleTribe: plan real-world gatherings with your tribe, and let a local
//! model work out what to bring from the description, the forecast and the route.
//!
//! One binary serves the API and the web app. Settings come from `OLT_*`
//! environment variables; see [`state::Config`].

mod auth;
mod conditions;
mod error;
mod facts;
mod place_search;
mod routes;
mod state;
mod stores_on_route;
mod web;

use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use tokio::sync::Semaphore;
use tribe_brain::{Brain, BrainConfig};
use tribe_db::{Db, images, maintenance, unix_now};
use tribe_media::MediaStore;
use tribe_places::{Endpoints, Places};

use crate::state::{AppState, Caches, Config, Limits};

const USER_AGENT: &str = concat!(
    "OurLittleTribe/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/arpanpathak/ourlittletribe)"
);

/// Deletes old rows every hour, then the picture files nothing refers to any more.
async fn purge_every_hour(db: Db, media: Arc<MediaStore>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(3600));
    loop {
        ticker.tick().await;
        match db
            .call(|connection| maintenance::purge(connection, unix_now()))
            .await
        {
            Ok(report) => tracing::info!(?report, "hourly clean-up"),
            Err(error) => tracing::error!(%error, "hourly clean-up failed"),
        }
        let in_use = match db.call(|connection| images::all_ids(connection)).await {
            Ok(ids) => ids.into_iter().map(|id| id.to_string()).collect(),
            Err(error) => {
                tracing::error!(%error, "listing pictures failed");
                continue;
            }
        };
        let store = media.clone();
        match tokio::task::spawn_blocking(move || store.sweep(&in_use)).await {
            Ok(Ok(0)) => {}
            Ok(Ok(removed)) => tracing::info!(removed, "deleted unused picture files"),
            Ok(Err(error)) => tracing::error!(%error, "picture clean-up failed"),
            Err(error) => tracing::error!(%error, "picture clean-up task failed"),
        }
    }
}

async fn shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    let mut terminate =
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(stream) => stream,
            Err(error) => {
                tracing::warn!(%error, "cannot listen for SIGTERM");
                let _ = interrupt.await;
                return;
            }
        };
    tokio::select! {
        _ = interrupt => {}
        _ = terminate.recv() => {}
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    let db = Db::open(&config.database)
        .with_context(|| format!("opening {}", config.database.display()))?;
    let media = Arc::new(
        MediaStore::open(&config.media)
            .with_context(|| format!("opening {}", config.media.display()))?,
    );
    let places = Places::new(USER_AGENT, Endpoints::default())?;
    let brain = match &config.llm_url {
        Some(base_url) => Some(Arc::new(Brain::new(BrainConfig {
            base_url: base_url.clone(),
            model: config.llm_model.clone(),
            api_key: config.llm_key.clone(),
            timeout: Duration::from_secs(120),
        })?)),
        None => None,
    };
    match &brain {
        Some(model) => match model.model_name().await {
            Ok(name) => tracing::info!(model = %name, "planning model ready"),
            Err(error) => {
                tracing::warn!(%error, "planning model not reachable yet; will retry on first use")
            }
        },
        None => tracing::warn!("OLT_LLM_URL is not set; prep planning and search are off"),
    }

    let state = AppState {
        db: db.clone(),
        places,
        brain,
        config: Arc::new(config.clone()),
        limits: Arc::new(Limits::standard()),
        caches: Arc::new(Caches::new()),
        media: media.clone(),
        picture_jobs: Arc::new(Semaphore::new(2)),
    };

    tokio::spawn(purge_every_hour(db, media));

    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .with_context(|| format!("binding {}", config.listen))?;
    tracing::info!(address = %config.listen, "OurLittleTribe is listening");
    axum::serve(listener, routes::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}
