//! Everything the model is told about one trip: the plan, the places, the
//! conditions hour by hour, the list so far, and what earlier groups bought.

use tribe_brain::{DriveFacts, TripFacts, WeatherFacts};
use tribe_core::basket::{EvidenceThreshold, Pairing, bought_with};
use tribe_core::clock::{format_local, format_local_clock};
use tribe_db::events::Event;
use tribe_db::prep;
use tribe_db::stops::{self, Stop};
use tribe_places::osrm::Route;
use tribe_places::weather::{DayForecast, HourForecast};

use crate::conditions::{self, Conditions};
use crate::error::ApiResult;
use crate::state::AppState;

/// Pairings shown per item at most.
const PAIRINGS_PER_ITEM: usize = 3;

fn pairing_line(item: &str, pairing: &Pairing) -> String {
    format!(
        "groups that got {} also got {} in {} trips ({:.0}% of the time, lift {:.1})",
        item.to_lowercase(),
        pairing.item,
        pairing.together,
        pairing.confidence * 100.0,
        pairing.lift
    )
}

/// Lines saying what earlier groups bought alongside the items on this list.
async fn learned_pairings(state: &AppState, listed: &[String]) -> ApiResult<Vec<String>> {
    let baskets = state
        .db
        .call(|connection| prep::baskets(connection))
        .await?;

    let mut lines = Vec::new();
    for item in listed {
        let pairings = bought_with(&baskets, item, EvidenceThreshold::default());
        for pairing in pairings.iter().take(PAIRINGS_PER_ITEM) {
            lines.push(pairing_line(item, pairing));
        }
    }
    Ok(lines)
}

/// A stop as one line, such as "Stop on the way: Ashford coffee (restrooms, 15 min)".
fn stop_line(stop: &Stop) -> String {
    let kind = stop.kind.label();
    match stop.note.is_empty() {
        true => format!("{kind}: {}", stop.place.name),
        false => format!("{kind}: {} ({})", stop.place.name, stop.note),
    }
}

/// One forecast hour as one line, in the event's local time.
fn hour_line(hour: &HourForecast, offset_minutes: i64) -> String {
    let snow = match hour.snowfall_cm > 0.0 {
        true => format!(", {:.1} cm snow", hour.snowfall_cm),
        false => String::new(),
    };
    let freezing = match hour.freezing_level_m {
        Some(level) => format!(", freezing level {level:.0} m"),
        None => String::new(),
    };

    format!(
        "{}: {:.0} °C (feels {:.0} °C), {}, precipitation chance {:.0}% ({:.1} mm{snow}), wind {:.0} km/h gusting {:.0}{freezing}",
        format_local_clock(hour.time, offset_minutes),
        hour.temp_c,
        hour.feels_like_c,
        hour.sky.words(),
        hour.precipitation_chance,
        hour.precipitation_mm,
        hour.wind_kmh,
        hour.gusts_kmh,
    )
}

fn weather_facts(forecast: &DayForecast, offset_minutes: i64) -> WeatherFacts {
    WeatherFacts {
        max_temp_c: forecast.max_temp_c,
        min_temp_c: forecast.min_temp_c,
        precipitation_chance: forecast.precipitation_chance,
        precipitation_mm: forecast.precipitation_mm,
        snowfall_cm: forecast.snowfall_cm,
        max_wind_kmh: forecast.max_wind_kmh,
        max_uv_index: forecast.max_uv_index,
        sunrise_local: format_local_clock(forecast.sunrise, offset_minutes),
        sunset_local: format_local_clock(forecast.sunset, offset_minutes),
    }
}

fn hour_lines(conditions: &Conditions, offset_minutes: i64) -> Vec<String> {
    let Some(forecast) = &conditions.forecast else {
        return Vec::new();
    };
    forecast
        .hours
        .iter()
        .map(|hour| hour_line(hour, offset_minutes))
        .collect()
}

/// Everything the model is told about this event; `drive` is the asking
/// person's route, when they shared where they start.
pub async fn for_event(
    state: &AppState,
    event: &Event,
    drive: Option<&Route>,
) -> ApiResult<TripFacts> {
    let conditions = conditions::for_event(state, event).await;
    let offset = event.tz_offset_minutes;

    let event_id = event.id.clone();
    let (items, event_stops) = state
        .db
        .call(move |connection| {
            Ok((
                prep::list(connection, &event_id)?,
                stops::for_event(connection, &event_id)?,
            ))
        })
        .await?;

    let already_listed: Vec<String> = items.into_iter().map(|item| item.name).collect();
    let learned = learned_pairings(state, &already_listed).await?;

    Ok(TripFacts {
        title: event.title.clone(),
        description: event.description.clone(),
        place_name: event.meeting_point.name.clone(),
        starts_local: format_local(event.starts_at, offset),
        group_size: u32::try_from(event.going_count).unwrap_or(1),
        elevation_m: conditions.elevation_m,
        weather: conditions
            .forecast
            .as_ref()
            .map(|forecast| weather_facts(forecast, offset)),
        drive: drive.map(|route| DriveFacts {
            minutes: route.duration_minutes,
            km: route.distance_km,
        }),
        already_listed,
        learned_pairings: learned,
        itinerary: event_stops.iter().map(stop_line).collect(),
        hourly: hour_lines(&conditions, offset),
        conditions_place: conditions.place_name,
    })
}
