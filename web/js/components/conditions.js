// The Conditions card on an event page: the model's briefing for this plan,
// the forecast hour by hour around the start, and daylight, freezing level and
// elevation at the venue (or the meeting point when there is no venue).

import { api } from "../api.js";
import { h, mount, icon, formatTime } from "../ui.js";
import { imperial, temperature, temperatureParts, height, speed } from "../units.js";

const VERDICT_WORDS = { great: "Great day for it", good: "Good conditions", mixed: "Mixed conditions", poor: "Tough conditions" };
const POINT_ICONS = { timing: "clock", wear: "thermometer", safety: "alert", comfort: "sun", road: "route" };

/** How far below the venue the freezing level must come before it is worth showing, metres. */
const FREEZING_LEVEL_MARGIN_M = 600;

/** An icon for a WMO weather code; at night the sun becomes the moon. */
function skyIcon(code, night) {
  if (code === 0 || code === 1) return night ? "moon" : "sun";
  if (code === 2) return night ? "cloud" : "cloudSun";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

/* ── The model's briefing ─────────────────────────── */

function briefingView(briefing) {
  const head = h("div", { class: "briefing-head" },
    h("span", { class: "verdict" }, VERDICT_WORDS[briefing.verdict] || briefing.verdict),
    h("span", { class: "badge badge-ai" }, icon("sparkles", "sm"), "Model briefing"));

  const points = briefing.points.map((point) => {
    const pointIcon = h("span", { class: `point-icon point-${point.kind}` }, icon(POINT_ICONS[point.kind] || "info", "sm"));
    return h("li", {}, pointIcon, h("span", {}, point.text));
  });

  return h("div", { class: `briefing briefing-${briefing.verdict}` },
    head,
    h("p", { class: "briefing-headline" }, briefing.headline),
    h("ul", { class: "briefing-points" }, points));
}

/** Fills `slot` with the briefing once the model has written it. */
async function loadBriefing(slot, eventId) {
  mount(slot, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Reading the forecast for your plan…"));

  try {
    const briefing = await api.briefing(eventId, imperial);
    mount(slot, briefingView(briefing));
  } catch (error) {
    mount(slot, h("p", { class: "small muted" }, `No briefing right now: ${error.message}`));
  }
}

/* ── Hour by hour ─────────────────────────────────── */

function hourCell(hour, forecast, startHour) {
  const night = hour.time < forecast.sunrise - 1800 || hour.time >= forecast.sunset;
  const isStart = hour.time === startHour;
  const sunsetThisHour = forecast.sunset >= hour.time && forecast.sunset < hour.time + 3600;
  const [mainTemp, otherTemp] = temperatureParts(hour.temp_c);
  const rainChance = Math.round(hour.precipitation_chance);

  const classes = ["hour"];
  if (isStart) classes.push("is-start");
  if (night) classes.push("is-night");

  const rainBar = h("span", { class: "rain-bar" }, h("span", { style: `height:${Math.max(2, rainChance)}%` }));
  const sunset = sunsetThisHour ? h("span", { class: "hour-sunset" }, icon("sunset", "sm"), formatTime(forecast.sunset)) : null;

  return h("div", { class: classes.join(" "), role: "listitem" },
    h("span", { class: "hour-time" }, isStart ? "Start" : formatTime(hour.time).replace(":00", "")),
    h("span", { class: "hour-sky" }, icon(skyIcon(hour.weather_code, night))),
    h("span", { class: "hour-temp" }, mainTemp, h("small", {}, otherTemp)),
    h("span", { class: "hour-rain", title: "Chance of rain" }, rainBar, `${rainChance}%`),
    h("span", { class: "hour-wind", title: `Gusts ${speed(hour.gusts_kmh)}` }, speed(hour.wind_kmh)),
    sunset);
}

function hourStrip(forecast, startsAt) {
  const hours = forecast.hours || [];
  if (!hours.length) return null;

  const startHour = Math.floor(startsAt / 3600) * 3600;
  const cells = hours.map((hour) => hourCell(hour, forecast, startHour));
  return h("div", { class: "hours", role: "list", "aria-label": "Hour by hour" }, cells);
}

/* ── Facts under the strip ────────────────────────── */

function lowestFreezingLevel(forecast) {
  const levels = [];
  for (const hour of forecast.hours || []) {
    if (hour.freezing_level_m !== null && hour.freezing_level_m !== undefined) levels.push(hour.freezing_level_m);
  }
  return levels.length ? Math.min(...levels) : null;
}

/** [icon, label, value] for each fact worth showing. */
function factsFor(forecast, elevation) {
  const facts = [];
  const hasElevation = elevation !== null && elevation !== undefined;

  if (forecast) {
    facts.push(["thermometer", "High", temperature(forecast.max_temp_c)]);
    facts.push(["thermometer", "Low", temperature(forecast.min_temp_c)]);
    facts.push(["sunset", "Daylight", `${formatTime(forecast.sunrise)} – ${formatTime(forecast.sunset)}`]);

    const freezing = lowestFreezingLevel(forecast);
    if (freezing !== null && hasElevation && freezing < elevation + FREEZING_LEVEL_MARGIN_M) {
      facts.push(["snow", "Freezing level", `${height(freezing)} and up`]);
    }

    if (forecast.max_uv_index >= 3) facts.push(["sun", "UV index", forecast.max_uv_index.toFixed(0)]);
  }

  if (hasElevation) facts.push(["mountain", "Elevation", height(elevation)]);
  return facts;
}

function factRow(facts) {
  if (!facts.length) return null;

  const items = facts.map(([iconName, label, value]) =>
    h("div", { class: "fact" }, icon(iconName, "sm"), h("span", { class: "muted" }, label), h("b", {}, value)));
  return h("div", { class: "fact-row" }, items);
}

/* ── The card ─────────────────────────────────────── */

/** The Conditions card for an event's detail (as the server sends it). */
export function conditionsCard(detail) {
  const { forecast, elevation_m: elevation, place_name: placeName } = detail.conditions;
  const briefingSlot = h("div");

  const head = h("div", { class: "card-head" },
    h("div", {}, h("h3", {}, "Conditions"), h("div", { class: "small muted" }, `At ${placeName}`)),
    h("span", { class: "small muted" }, "Forecast: Open-Meteo"));

  const notYet = forecast ? null : h("p", { class: "small muted" }, "The hour-by-hour forecast appears about 16 days before the event.");
  const strip = forecast ? hourStrip(forecast, detail.event.starts_at) : null;
  const body = h("div", { class: "card-body stack", style: "gap:16px" }, briefingSlot, strip, factRow(factsFor(forecast, elevation)), notYet);

  if (detail.model_ready) loadBriefing(briefingSlot, detail.event.id);
  return h("section", { class: "card" }, head, body);
}
