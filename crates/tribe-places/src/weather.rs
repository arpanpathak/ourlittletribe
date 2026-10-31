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
    /// Hour by hour, from an hour before the event to about eight hours after it starts.
    pub hours: Vec<HourForecast>,
}

/// One hour of the forecast.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HourForecast {
    /// Start of the hour, Unix seconds.
    pub time: i64,
    /// Air temperature, °C.
    pub temp_c: f64,
    /// How cold it feels with wind and humidity, °C.
    pub feels_like_c: f64,
    /// Chance of precipitation, percent.
    pub precipitation_chance: f64,
    /// Precipitation, mm.
    pub precipitation_mm: f64,
    /// Snowfall, cm.
    pub snowfall_cm: f64,
    /// What the sky is doing.
    pub sky: Sky,
    /// Cloud cover, percent.
    pub cloud_cover: f64,
    /// Wind, km/h.
    pub wind_kmh: f64,
    /// Gusts, km/h.
    pub gusts_kmh: f64,
    /// Height above sea level where it freezes, metres.
    pub freezing_level_m: Option<f64>,
}

/// What the sky is doing in an hour, decoded from its WMO weather code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Sky {
    /// Code 0.
    Clear,
    /// Code 1.
    MainlyClear,
    /// Code 2.
    PartlyCloudy,
    /// Code 3.
    Overcast,
    /// Codes 45 and 48.
    Fog,
    /// Codes 51 to 57.
    Drizzle,
    /// Codes 61 to 67.
    Rain,
    /// Codes 71 to 77.
    Snow,
    /// Codes 80 to 82.
    RainShowers,
    /// Codes 85 and 86.
    SnowShowers,
    /// Codes 95 to 99.
    Thunderstorm,
    /// Any other code.
    Unknown,
}

impl Sky {
    /// The sky for a WMO weather code, as Open-Meteo documents them.
    pub fn from_wmo_code(code: u8) -> Sky {
        match code {
            0 => Sky::Clear,
            1 => Sky::MainlyClear,
            2 => Sky::PartlyCloudy,
            3 => Sky::Overcast,
            45 | 48 => Sky::Fog,
            51..=57 => Sky::Drizzle,
            61..=67 => Sky::Rain,
            71..=77 => Sky::Snow,
            80..=82 => Sky::RainShowers,
            85 | 86 => Sky::SnowShowers,
            95..=99 => Sky::Thunderstorm,
            _ => Sky::Unknown,
        }
    }

    /// The sky in a few words, such as "partly cloudy".
    pub fn words(self) -> &'static str {
        match self {
            Sky::Clear => "clear",
            Sky::MainlyClear => "mainly clear",
            Sky::PartlyCloudy => "partly cloudy",
            Sky::Overcast => "overcast",
            Sky::Fog => "fog",
            Sky::Drizzle => "drizzle",
            Sky::Rain => "rain",
            Sky::Snow => "snow",
            Sky::RainShowers => "rain showers",
            Sky::SnowShowers => "snow showers",
            Sky::Thunderstorm => "thunderstorms",
            Sky::Unknown => "mixed",
        }
    }
}

/// Hours of the forecast kept before and after an event starts.
const HOURS_BEFORE: i64 = 1;
const HOURS_AFTER: i64 = 9;

#[derive(Deserialize)]
struct ForecastResponse {
    daily: DailyColumns,
    #[serde(default)]
    hourly: Option<HourlyColumns>,
}

#[derive(Deserialize)]
struct HourlyColumns {
    time: Vec<i64>,
    temperature_2m: Vec<Option<f64>>,
    apparent_temperature: Vec<Option<f64>>,
    precipitation_probability: Vec<Option<f64>>,
    precipitation: Vec<Option<f64>>,
    snowfall: Vec<Option<f64>>,
    weather_code: Vec<Option<u8>>,
    cloud_cover: Vec<Option<f64>>,
    wind_speed_10m: Vec<Option<f64>>,
    wind_gusts_10m: Vec<Option<f64>>,
    freezing_level_height: Vec<Option<f64>>,
}

impl HourlyColumns {
    /// The hours from shortly before `moment` to several hours after it.
    fn around(&self, moment: i64) -> Vec<HourForecast> {
        let first = moment - HOURS_BEFORE * 3600;
        let last = moment + HOURS_AFTER * 3600;
        self.time
            .iter()
            .enumerate()
            .filter(|(_, time)| (first - 3599..=last).contains(*time))
            .map(|(index, time)| HourForecast {
                time: *time,
                temp_c: column_value(&self.temperature_2m, index),
                feels_like_c: column_value(&self.apparent_temperature, index),
                precipitation_chance: column_value(&self.precipitation_probability, index),
                precipitation_mm: column_value(&self.precipitation, index),
                snowfall_cm: column_value(&self.snowfall, index),
                sky: Sky::from_wmo_code(column_value(&self.weather_code, index)),
                cloud_cover: column_value(&self.cloud_cover, index),
                wind_kmh: column_value(&self.wind_speed_10m, index),
                gusts_kmh: column_value(&self.wind_gusts_10m, index),
                freezing_level_m: self.freezing_level_height.get(index).copied().flatten(),
            })
            .collect()
    }
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
            hours: Vec::new(),
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
            (
                "hourly",
                "temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,freezing_level_height".to_string(),
            ),
            ("timezone", "auto".to_string()),
            ("timeformat", "unixtime".to_string()),
            ("forecast_days", "16".to_string()),
        ]);
        let response: ForecastResponse = self.get_json("Open-Meteo", request).await?;
        let forecast = response.daily.day_containing(moment).map(|day| {
            let mut forecast = response.daily.forecast_for(day);
            if let Some(hourly) = &response.hourly {
                forecast.hours = hourly.around(moment);
            }
            forecast
        });
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
    fn keeps_the_hours_around_the_event() -> Result<(), serde_json::Error> {
        let times: Vec<String> = (0..24).map(|hour| (hour * 3600).to_string()).collect();
        let column = |value: &str| vec![value; 24].join(",");
        let body = format!(
            r#"{{"time":[{}],"temperature_2m":[{}],"apparent_temperature":[{}],"precipitation_probability":[{}],
            "precipitation":[{}],"snowfall":[{}],"weather_code":[{}],"cloud_cover":[{}],"wind_speed_10m":[{}],
            "wind_gusts_10m":[{}],"freezing_level_height":[{}]}}"#,
            times.join(","),
            column("5.0"),
            column("3.0"),
            column("20"),
            column("0.0"),
            column("0.0"),
            column("3"),
            column("80"),
            column("10.0"),
            column("20.0"),
            column("null"),
        );
        let hourly: HourlyColumns = serde_json::from_str(&body)?;
        let hours = hourly.around(10 * 3600 + 900);
        assert_eq!(hours.first().map(|hour| hour.time), Some(9 * 3600));
        assert_eq!(hours.last().map(|hour| hour.time), Some(19 * 3600));
        assert_eq!(hours[0].freezing_level_m, None);
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
