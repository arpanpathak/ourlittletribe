//! Formatting Unix times as local calendar times without a time-zone database.
//!
//! An event stores the UTC offset of the place it happens, so a fixed offset
//! is all that is needed.

const WEEKDAYS: [&str; 7] = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];

/// Converts days since 1970-01-01 to a (year, month, day) date.
///
/// This is Howard Hinnant's `civil_from_days` algorithm.
pub fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let shifted = days_since_epoch + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = match month_index < 10 {
        true => month_index + 3,
        false => month_index - 9,
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Formats `unix_seconds` at `offset_minutes` from UTC as "Saturday 2026-11-07 08:00".
pub fn format_local(unix_seconds: i64, offset_minutes: i64) -> String {
    let local = unix_seconds + offset_minutes * 60;
    let days = local.div_euclid(86_400);
    let seconds_of_day = local.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let weekday = WEEKDAYS
        .get(days.rem_euclid(7) as usize)
        .copied()
        .unwrap_or("");
    format!(
        "{weekday} {year:04}-{month:02}-{day:02} {:02}:{:02}",
        seconds_of_day / 3600,
        seconds_of_day % 3600 / 60
    )
}

/// Formats only the clock time, "19:42".
pub fn format_local_clock(unix_seconds: i64, offset_minutes: i64) -> String {
    let seconds_of_day = (unix_seconds + offset_minutes * 60).rem_euclid(86_400);
    format!("{:02}:{:02}", seconds_of_day / 3600, seconds_of_day % 3600 / 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_is_thursday_first_of_january() {
        assert_eq!(format_local(0, 0), "Thursday 1970-01-01 00:00");
    }

    #[test]
    fn pacific_morning_hike() {
        assert_eq!(format_local(1_794_067_200, -480), "Saturday 2026-11-07 08:00");
        assert_eq!(format_local_clock(1_794_067_200, -480), "08:00");
    }

    #[test]
    fn leap_day() {
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    }
}
