//! The forecast and elevation at a point, from Open-Meteo.

use serde::{Deserialize, Serialize};
use tribe_core::geo::LatLng;

use crate::{Places, PlacesError};

/// The forecast for the day of an event, at the meeting point.
#[derive(Debug, Clone, Serialize)]
pub struct DayForecast {
    /// Highest temperature, °C.
    pub max_temp_c: f64,
    /// Lowest temperature, °C.
    pub min_temp_c: f64,
    /// Highest chance of precipitation in any hour, percent.
    pub precipitation_chance: f64,
    /// Total precipitation, mm.
    pub precipitation_mm: f64,
    /// Total snowfall, cm.
    pub snowfall_cm: f64,
    /// Strongest wind, km/h.
    pub max_wind_kmh: f64,
    /// Highest UV index.
    pub max_uv_index: f64,
    /// Sunrise, Unix seconds.
    pub sunrise: i64,
    /// Sunset, Unix seconds.
    pub sunset: i64,
}

#[derive(Deserialize)]
struct ForecastResponse {
    daily: DailyColumns,
}

#[derive(Deserialize)]
struct DailyColumns {
    time: Vec<i64>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    precipitation_probability_max: Vec<Option<f64>>,
    precipitation_sum: Vec<Option<f64>>,
    snowfall_sum: Vec<Option<f64>>,
    wind_speed_10m_max: Vec<Option<f64>>,
    uv_index_max: Vec<Option<f64>>,
    sunrise: Vec<Option<i64>>,
    sunset: Vec<Option<i64>>,
}

#[derive(Deserialize)]
struct ElevationResponse {
    elevation: Vec<f64>,
}

fn column_value<T: Copy + Default>(column: &[Option<T>], day: usize) -> T {
    column.get(day).copied().flatten().unwrap_or_default()
}

impl DailyColumns {
    fn day_containing(&self, moment: i64) -> Option<usize> {
        self.time
            .iter()
            .position(|day_start| (*day_start..*day_start + 86_400).contains(&moment))
    }

    fn forecast_for(&self, day: usize) -> DayForecast {
        DayForecast {
            max_temp_c: column_value(&self.temperature_2m_max, day),
            min_temp_c: column_value(&self.temperature_2m_min, day),
            precipitation_chance: column_value(&self.precipitation_probability_max, day),
            precipitation_mm: column_value(&self.precipitation_sum, day),
            snowfall_cm: column_value(&self.snowfall_sum, day),
            max_wind_kmh: column_value(&self.wind_speed_10m_max, day),
            max_uv_index: column_value(&self.uv_index_max, day),
            sunrise: column_value(&self.sunrise, day),
            sunset: column_value(&self.sunset, day),
        }
    }
}

impl Places {
    /// The forecast for the local day containing `moment` (Unix seconds), or `None`
    /// when that day is beyond Open-Meteo's 16-day range or already past.
    pub async fn day_forecast(
        &self,
        point: LatLng,
        moment: i64,
    ) -> Result<Option<DayForecast>, PlacesError> {
        let request = self.http.get(&self.endpoints.open_meteo).query(&[
            ("latitude", point.lat.to_string()),
            ("longitude", point.lng.to_string()),
            (
                "daily",
                "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset".to_string(),
            ),
            ("timezone", "auto".to_string()),
            ("timeformat", "unixtime".to_string()),
            ("forecast_days", "16".to_string()),
        ]);
        let response: ForecastResponse = self.get_json("Open-Meteo", request).await?;
        let forecast = response
            .daily
            .day_containing(moment)
            .map(|day| response.daily.forecast_for(day));
        Ok(forecast)
    }

    /// Ground elevation in metres at `point`.
    pub async fn elevation_m(&self, point: LatLng) -> Result<Option<f64>, PlacesError> {
        let request = self.http.get(&self.endpoints.open_meteo_elevation).query(&[
            ("latitude", point.lat.to_string()),
            ("longitude", point.lng.to_string()),
        ]);
        let response: ElevationResponse = self.get_json("Open-Meteo elevation", request).await?;
        Ok(response.elevation.first().copied())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_local_day_holding_the_moment() -> Result<(), serde_json::Error> {
        let body = r#"{"daily":{
            "time":[1000000,1086400],
            "temperature_2m_max":[10.0,4.0],"temperature_2m_min":[2.0,-3.0],
            "precipitation_probability_max":[10.0,60.0],"precipitation_sum":[0.0,3.5],
            "snowfall_sum":[0.0,2.0],"wind_speed_10m_max":[8.0,25.0],"uv_index_max":[3.0,1.5],
            "sunrise":[1020000,1106400],"sunset":[1060000,1146400]}}"#;
        let response: ForecastResponse = serde_json::from_str(body)?;
        let Some(day) = response.daily.day_containing(1_100_000) else {
            panic!("day not found");
        };
        let forecast = response.daily.forecast_for(day);
        assert!((forecast.min_temp_c + 3.0).abs() < 1e-9);
        assert!((forecast.snowfall_cm - 2.0).abs() < 1e-9);
        assert_eq!(response.daily.day_containing(5_000_000), None);
        Ok(())
    }

    #[test]
    fn missing_values_read_as_zero() -> Result<(), serde_json::Error> {
        let body = r#"{"daily":{"time":[0],"temperature_2m_max":[null],"temperature_2m_min":[null],
            "precipitation_probability_max":[null],"precipitation_sum":[null],"snowfall_sum":[null],
            "wind_speed_10m_max":[null],"uv_index_max":[null],"sunrise":[null],"sunset":[null]}}"#;
        let response: ForecastResponse = serde_json::from_str(body)?;
        let forecast = response.daily.forecast_for(0);
        assert_eq!(forecast.sunrise, 0);
        Ok(())
    }
}
