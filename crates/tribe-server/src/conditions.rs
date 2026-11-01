//! The forecast and elevation where an event happens: at its venue when it
//! has one, else at its meeting point, where a hike's weather is not.

use serde::Serialize;
use tribe_core::itinerary::Place;
use tribe_db::events::Event;
use tribe_db::stops::{self, Stop};
use tribe_places::weather::DayForecast;

use crate::state::AppState;

/// The forecast and elevation at the place an event happens.
#[derive(Debug, Clone, Serialize)]
pub struct Conditions {
    /// The place they are for.
    pub place_name: String,
    /// Ground elevation, metres.
    pub elevation_m: Option<f64>,
    /// The forecast for the event's day, once it is within 16 days.
    pub forecast: Option<DayForecast>,
}

/// The venue if the event has one, else its meeting point.
fn where_it_happens(event: &Event, event_stops: Vec<Stop>) -> Place {
    match event_stops.into_iter().find(Stop::is_venue) {
        Some(venue) => venue.place,
        None => event.meeting_point.clone(),
    }
}

/// Where an event happens: its venue, else its meeting point. If the stops
/// cannot be read, the meeting point.
pub(crate) async fn place_of(state: &AppState, event: &Event) -> Place {
    let event_id = event.id.clone();
    let event_stops = state
        .db
        .call(move |connection| stops::for_event(connection, &event_id))
        .await
        .unwrap_or_default();

    where_it_happens(event, event_stops)
}

/// The conditions for an event, from a 30-minute cache or from Open-Meteo.
/// A failed lookup leaves that part empty; the page says so.
pub async fn for_event(state: &AppState, event: &Event) -> Conditions {
    if let Some(cached) = state.caches.conditions.get(&event.id) {
        return cached;
    }

    let place = place_of(state, event).await;

    let (elevation, forecast) = tokio::join!(
        state.places.elevation_m(place.point),
        state.places.day_forecast(place.point, event.starts_at)
    );

    let conditions = Conditions {
        place_name: place.name,
        elevation_m: elevation.unwrap_or_else(|error| {
            tracing::warn!(%error, "elevation lookup failed");
            None
        }),
        forecast: forecast.unwrap_or_else(|error| {
            tracing::warn!(%error, "forecast lookup failed");
            None
        }),
    };

    state
        .caches
        .conditions
        .put(event.id.clone(), conditions.clone());
    conditions
}
