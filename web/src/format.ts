// Dates, times and numbers as people read them. Temperatures and heights
// show both scales, the reader's own first; US English readers get °F, mph
// and feet first.

import type { Units } from "./api/types.js";

const toDate = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

/** "Sat, Nov 7" */
export function formatDay(unixSeconds: number): string {
  return toDate(unixSeconds).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Saturday, November 7, 2026" */
export function formatLongDay(unixSeconds: number): string {
  return toDate(unixSeconds).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "8:00 AM" */
export function formatTime(unixSeconds: number): string {
  return toDate(unixSeconds).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Sat, Nov 7 · 8:00 AM" */
export function formatWhen(unixSeconds: number): string {
  return `${formatDay(unixSeconds)} · ${formatTime(unixSeconds)}`;
}

/** Month and day, for a calendar chip. */
export function dateParts(unixSeconds: number): { month: string; day: string } {
  const date = toDate(unixSeconds);
  return { month: date.toLocaleDateString(undefined, { month: "short" }), day: String(date.getDate()) };
}

const RELATIVE_STEPS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "second"],
  [3600, "minute"],
  [86400, "hour"],
  [604800, "day"],
  [2629800, "week"],
  [31557600, "month"],
];

/** "in 3 days", "tomorrow", "2 hours ago". */
export function relativeTime(unixSeconds: number): string {
  const seconds = unixSeconds - Date.now() / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  let divisor = 1;
  for (const [limit, unit] of RELATIVE_STEPS) {
    if (Math.abs(seconds) < limit) return format.format(Math.round(seconds / divisor), unit);
    divisor = limit;
  }
  return format.format(Math.round(seconds / 31557600), "year");
}

/** "Today", "Tomorrow", "Saturday" or "Saturday, November 14", for grouping by day. */
export function dayHeading(unixSeconds: number): string {
  const date = toDate(unixSeconds);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  const daysAway = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway > 1 && daysAway < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Values for `<input type="date">` and `<input type="time">`. */
export function dateAndTimeInputs(unixSeconds: number): { date: string; time: string } {
  const date = toDate(unixSeconds);
  const pad = (number: number) => String(number).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** Unix seconds from date and time input values, in the viewer's time zone. */
export function unixFromInputs(dateValue: string, timeValue: string): number {
  return Math.floor(new Date(`${dateValue}T${timeValue || "00:00"}`).getTime() / 1000);
}

/* ── Units ───────────────────────────────────────── */

/** Whether the reader uses °F, mph, miles and feet first. */
export const imperial = /^en-US\b/.test(navigator.language || "") || navigator.language === "en";

/** The reader's units, as the briefing API names them. */
export const readerUnits: Units = imperial ? "imperial" : "metric";

const fahrenheit = (celsius: number) => `${Math.round(celsius * 1.8 + 32)}°F`;
const celsiusText = (celsius: number) => `${Math.round(celsius)}°C`;
const feet = (metres: number) => `${Math.round(metres * 3.281).toLocaleString()} ft`;
const metresText = (metres: number) => `${Math.round(metres).toLocaleString()} m`;

/** The reader's temperature scale and the other one, for showing on two lines. */
export function temperatureParts(celsius: number): [string, string] {
  return imperial ? [fahrenheit(celsius), celsiusText(celsius)] : [celsiusText(celsius), fahrenheit(celsius)];
}

/** Both scales, the reader's own first: "43°F (6°C)". */
export function temperature(celsius: number): string {
  const [main, other] = temperatureParts(celsius);
  return `${main} (${other})`;
}

/** Both units, the reader's own first: "5,440 ft (1,658 m)". */
export function height(metres: number): string {
  return imperial ? `${feet(metres)} (${metresText(metres)})` : `${metresText(metres)} (${feet(metres)})`;
}

/** "12 mph" or "19 km/h". */
export function speed(kmh: number): string {
  return imperial ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`;
}

/** "25 mi" or "40 km". */
export function distance(km: number): string {
  return imperial ? `${Math.round(km * 0.621)} mi` : `${Math.round(km)} km`;
}

/** "1 h 20 min" or "35 min". */
export function duration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** "1 member", "3 members". */
export function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}
