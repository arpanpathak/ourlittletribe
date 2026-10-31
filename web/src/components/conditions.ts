// The Conditions card on an event page: the model's briefing for this plan,
// the forecast hour by hour around the start, and daylight, freezing level and
// elevation at the venue (or the meeting point when there is no venue).

import { events } from "../api/client.js";
import type { Briefing, DayForecast, EventDetail, HourForecast, PointKind, Sky, Verdict } from "../api/types.js";
import { h, mount } from "../dom.js";
import { formatTime, height, readerUnits, speed, temperature, temperatureParts } from "../format.js";
import { icon, type IconName } from "../icons.js";
import { errorMessage } from "../ui/feedback.js";

const VERDICT_WORDS: Record<Verdict, string> = {
  great: "Great day for it",
  good: "Good conditions",
  mixed: "Mixed conditions",
  poor: "Tough conditions",
};

const POINT_ICONS: Record<PointKind, IconName> = {
  timing: "clock",
  wear: "thermometer",
  safety: "alert",
  comfort: "sun",
  road: "route",
};

/** How far below the venue the freezing level must come before it is worth showing, metres. */
const FREEZING_LEVEL_MARGIN_M = 600;

/** One fact under the hour strip. */
interface Fact {
  /** Its icon. */
  icon: IconName;
  /** What it is, such as "Daylight". */
  label: string;
  /** Its value, ready to show. */
  value: string;
}

/** An icon for the sky; at night the sun becomes the moon. */
function skyIcon(sky: Sky, night: boolean): IconName {
  switch (sky) {
    case "clear":
    case "mainly_clear":
      return night ? "moon" : "sun";
    case "partly_cloudy":
      return night ? "cloud" : "cloudSun";
    case "fog":
      return "fog";
    case "snow":
    case "snow_showers":
      return "snow";
    case "thunderstorm":
      return "storm";
    case "drizzle":
    case "rain":
    case "rain_showers":
      return "rain";
    case "overcast":
    case "unknown":
      return "cloud";
  }
}

/* ── The model's briefing ─────────────────────────── */

function briefingView(briefing: Briefing): HTMLElement {
  const head = h("div", { class: "briefing-head" },
    h("span", { class: "verdict" }, VERDICT_WORDS[briefing.verdict]),
    h("span", { class: "badge badge-ai" }, icon("sparkles", "sm"), "Model briefing"));

  const points = briefing.points.map((point) =>
    h("li", {}, h("span", { class: `point-icon point-${point.kind}` }, icon(POINT_ICONS[point.kind], "sm")), h("span", {}, point.text)));

  return h("div", { class: `briefing briefing-${briefing.verdict}` }, head, h("p", { class: "briefing-headline" }, briefing.headline), h("ul", { class: "briefing-points" }, points));
}

/** Fills `slot` with the briefing once the model has written it. */
async function loadBriefing(slot: HTMLElement, eventId: string): Promise<void> {
  mount(slot, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Reading the forecast for your plan…"));

  try {
    mount(slot, briefingView(await events.briefing(eventId, readerUnits)));
  } catch (error) {
    mount(slot, h("p", { class: "small muted" }, `No briefing right now: ${errorMessage(error)}`));
  }
}

/* ── Hour by hour ─────────────────────────────────── */

function hourCell(hour: HourForecast, forecast: DayForecast, startHour: number): HTMLElement {
  const night = hour.time < forecast.sunrise - 1800 || hour.time >= forecast.sunset;
  const isStart = hour.time === startHour;
  const sunsetThisHour = forecast.sunset >= hour.time && forecast.sunset < hour.time + 3600;
  const [mainTemp, otherTemp] = temperatureParts(hour.temp_c);
  const rainChance = Math.round(hour.precipitation_chance);

  const classes = ["hour", isStart ? "is-start" : "", night ? "is-night" : ""].filter(Boolean).join(" ");
  const rainBar = h("span", { class: "rain-bar" }, h("span", { style: `height:${Math.max(2, rainChance)}%` }));
  const sunset = sunsetThisHour ? h("span", { class: "hour-sunset" }, icon("sunset", "sm"), formatTime(forecast.sunset)) : null;

  return h("div", { class: classes, role: "listitem" },
    h("span", { class: "hour-time" }, isStart ? "Start" : formatTime(hour.time).replace(":00", "")),
    h("span", { class: "hour-sky" }, icon(skyIcon(hour.sky, night))),
    h("span", { class: "hour-temp" }, mainTemp, h("small", {}, otherTemp)),
    h("span", { class: "hour-rain", title: "Chance of rain" }, rainBar, `${rainChance}%`),
    h("span", { class: "hour-wind", title: `Gusts ${speed(hour.gusts_kmh)}` }, speed(hour.wind_kmh)),
    sunset);
}

function hourStrip(forecast: DayForecast, startsAt: number): HTMLElement | null {
  if (!forecast.hours.length) return null;

  const startHour = Math.floor(startsAt / 3600) * 3600;
  const cells = forecast.hours.map((hour) => hourCell(hour, forecast, startHour));
  return h("div", { class: "hours", role: "list", "aria-label": "Hour by hour" }, cells);
}

/* ── Facts under the strip ────────────────────────── */

function lowestFreezingLevel(forecast: DayForecast): number | null {
  const levels = forecast.hours.flatMap((hour) => (hour.freezing_level_m === null ? [] : [hour.freezing_level_m]));
  return levels.length ? Math.min(...levels) : null;
}

function forecastFacts(forecast: DayForecast, elevation: number | null): Fact[] {
  const facts: Fact[] = [
    { icon: "thermometer", label: "High", value: temperature(forecast.max_temp_c) },
    { icon: "thermometer", label: "Low", value: temperature(forecast.min_temp_c) },
    { icon: "sunset", label: "Daylight", value: `${formatTime(forecast.sunrise)} – ${formatTime(forecast.sunset)}` },
  ];

  const freezing = lowestFreezingLevel(forecast);
  const freezingNearby = freezing !== null && elevation !== null && freezing < elevation + FREEZING_LEVEL_MARGIN_M;
  if (freezingNearby) facts.push({ icon: "snow", label: "Freezing level", value: `${height(freezing)} and up` });

  if (forecast.max_uv_index >= 3) facts.push({ icon: "sun", label: "UV index", value: forecast.max_uv_index.toFixed(0) });
  return facts;
}

function factRow(facts: Fact[]): HTMLElement | null {
  if (!facts.length) return null;

  const items = facts.map((fact) => h("div", { class: "fact" }, icon(fact.icon, "sm"), h("span", { class: "muted" }, fact.label), h("b", {}, fact.value)));
  return h("div", { class: "fact-row" }, items);
}

/* ── The card ─────────────────────────────────────── */

/** The Conditions card for an event page. */
export function conditionsCard(detail: EventDetail): HTMLElement {
  const { forecast, elevation_m: elevation, place_name: placeName } = detail.conditions;
  const briefingSlot = h("div");

  const head = h("div", { class: "card-head" },
    h("div", {}, h("h3", {}, "Conditions"), h("div", { class: "small muted" }, `At ${placeName}`)),
    h("span", { class: "small muted" }, "Forecast: Open-Meteo"));

  const facts = forecast ? forecastFacts(forecast, elevation) : [];
  if (elevation !== null) facts.push({ icon: "mountain", label: "Elevation", value: height(elevation) });

  const strip = forecast ? hourStrip(forecast, detail.event.starts_at) : null;
  const notYet = forecast ? null : h("p", { class: "small muted" }, "The hour-by-hour forecast appears about 16 days before the event.");
  const body = h("div", { class: "card-body stack conditions-body" }, briefingSlot, strip, factRow(facts), notYet);

  if (detail.model_ready) void loadBriefing(briefingSlot, detail.event.id);
  return h("section", { class: "card" }, head, body);
}
