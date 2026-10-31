// One event: the overview, the shared packing list, getting there, and photos.

import { api } from "../api.js";
import {
  h, mount, icon, toast, avatar, avatarStack, actionButton, tabBar, emptyState, dropdown, menuItem, confirmAction,
  openModal, debounce, copyText, eventCover, pictureUrl, formatLongDay, formatTime, formatWhen, relativeTime,
} from "../ui.js";
import { createMap, pin, placePin, itineraryLine, itineraryUrl, routeLine, fitTo, directionsUrl, currentPosition } from "../map.js";
import { renderMarkdown, markdownToText } from "../markdown.js";
import { PLACE_KINDS, itinerary, pinLabels } from "../stops.js";
import { session, go, replaceRoute } from "../app.js";
import { choosePictures, pictureProblem } from "../components/picture_picker.js";

const TABS = ["overview", "list", "route", "photos"];

/* ── Units: US English readers get °F, mph and feet. ── */
const imperial = /^en-US\b/.test(navigator.language || "") || navigator.language === "en";
const temperature = (celsius) => (imperial ? `${Math.round(celsius * 1.8 + 32)}°F` : `${Math.round(celsius)}°C`);
const speed = (kmh) => (imperial ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`);
const height = (metres) => (imperial ? `${Math.round(metres * 3.281).toLocaleString()} ft` : `${Math.round(metres).toLocaleString()} m`);
const distance = (km) => (imperial ? `${Math.round(km * 0.621)} mi` : `${Math.round(km)} km`);

function duration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const rest = Math.round(totalMinutes % 60);
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

function detourText(minutes) {
  if (minutes < 1) return "On your way";
  return `+${duration(minutes)}`;
}

/** A calendar file for the event, three hours long. */
function downloadCalendarFile(event) {
  const stamp = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escape = (text) => text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OurLittleTribe//EN", "BEGIN:VEVENT",
    `UID:${event.id}@ourlittletribe`, `DTSTAMP:${stamp(Date.now() / 1000)}`,
    `DTSTART:${stamp(event.starts_at)}`, `DTEND:${stamp(event.starts_at + 3 * 3600)}`,
    `SUMMARY:${escape(event.title)}`, `LOCATION:${escape(event.place_name)}`, `GEO:${event.lat};${event.lng}`,
    `DESCRIPTION:${escape(`${markdownToText(event.description)}\n\n${window.location.href}`.trim())}`,
    "END:VEVENT", "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const link = h("a", { href: URL.createObjectURL(blob), download: `${event.title.replace(/[^\w -]+/g, "").trim() || "event"}.ics` });
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}

async function share(event) {
  const url = window.location.href.split("?")[0];
  if (navigator.share) {
    try {
      await navigator.share({ title: event.title, text: `${event.title} · ${formatWhen(event.starts_at)}`, url });
      return;
    } catch {
      /* cancelled; fall back to copying */
    }
  }
  copyText(url);
}

/** Draws the event page, opening `initialTab`. */
export async function renderEvent(view, eventId, initialTab) {
  let detail = await api.event(eventId);
  const me = session.user;
  let tab = TABS.includes(initialTab) ? initialTab : "overview";

  const heroSlot = h("div", { class: "stack-lg" });
  const tabsSlot = h("div");
  const bodySlot = h("div");

  const isGoing = () => detail.event.my_rsvp === "going";

  async function refresh() {
    detail = await api.event(eventId);
    drawHero();
    drawTabs();
  }

  /* ── Header ─────────────────────────────────────── */

  function coverActions() {
    if (!detail.can_manage) return null;
    const change = actionButton([icon("image", "sm"), detail.event.cover_image ? "Change cover" : "Add cover"], async () => {
      const [file] = await choosePictures(false);
      if (!file) return;
      const problem = pictureProblem(file);
      if (problem) throw new Error(problem);
      await api.setEventCover(eventId, file);
      toast("Cover updated", "success");
      await refresh();
    }, { class: "btn btn-sm btn-overlay" });
    const remove = detail.event.cover_image
      ? actionButton([icon("trash", "sm")], async () => {
          await api.removeEventCover(eventId);
          await refresh();
        }, { class: "btn btn-sm btn-overlay btn-icon", "aria-label": "Remove cover", title: "Remove cover" })
      : null;
    return h("div", { class: "cover-actions" }, change, remove);
  }

  function drawHero() {
    const { event } = detail;
    const past = event.starts_at < Date.now() / 1000 - 6 * 3600;
    const rsvp = isGoing()
      ? dropdown(h("button", { type: "button", class: "btn btn-soft" }, icon("check"), "You're going", icon("chevronDown", "sm")), () => [
          menuItem("x", "I can't make it", async () => {
            try {
              await api.rsvp(eventId, false);
              toast("You're no longer going");
              await refresh();
            } catch (error) {
              toast(error.message, "error");
            }
          }),
        ])
      : actionButton([icon("check"), "I'm going"], async () => {
          await api.rsvp(eventId, true);
          toast("See you there!", "success");
          await refresh();
        }, { class: "btn btn-primary" });

    const more = dropdown(h("button", { type: "button", class: "btn btn-icon", "aria-label": "More actions" }, icon("more")), () => [
      menuItem("download", "Add to calendar", () => downloadCalendarFile(event)),
      menuItem("navigation", "Directions", null, { href: tripDirections(), target: "_blank", rel: "noopener" }),
      detail.can_manage ? "-" : null,
      detail.can_manage ? menuItem("edit", "Edit event", null, { href: `#/events/${eventId}/edit` }) : null,
      detail.can_manage
        ? menuItem("trash", "Delete event", async () => {
            if (!(await confirmAction("Delete this event?", `“${event.title}”, its packing list and its photos will be deleted for everyone.`, "Delete event", true))) return;
            try {
              await api.deleteEvent(eventId);
              toast("Event deleted");
              go(`/tribes/${event.tribe_id}`);
            } catch (error) {
              toast(error.message, "error");
            }
          }, { class: "menu-danger" })
        : null,
    ].filter(Boolean));

    mount(heroSlot,
      h("div", { style: "position:relative" },
        eventCover(event, { small: false, className: "hero-cover" }),
        coverActions()),
      h("div", { class: "hero-head" },
        h("div", { class: "grow" },
          h("a", { class: "crumb", href: `#/tribes/${event.tribe_id}` }, icon("users", "sm"), event.tribe_name),
          h("h1", {}, event.title),
          h("div", { class: "facts" },
            h("span", {}, icon("calendar"), `${formatLongDay(event.starts_at)} · ${formatTime(event.starts_at)}`),
            h("span", {}, icon("pin"), event.place_name, detail.stops.length ? h("span", { class: "muted" }, ` + ${detail.stops.length} more ${detail.stops.length === 1 ? "place" : "places"}`) : null),
            h("span", {}, icon("users"), `${event.going_count} going`))),
        h("div", { class: "hero-actions" },
          past ? h("span", { class: "badge" }, "This event has ended") : rsvp,
          h("button", { type: "button", class: "btn", onclick: () => share(event) }, icon("share"), "Share"),
          more)));
  }

  /* ── Tabs ───────────────────────────────────────── */

  function drawTabs() {
    mount(tabsSlot, tabBar([
      ["overview", "Overview"],
      ["list", "Packing list", detail.items.length],
      ["route", "Getting there"],
      ["photos", "Photos", detail.photos.length],
    ], tab, (value) => {
      tab = value;
      replaceRoute(`/events/${eventId}${value === "overview" ? "" : `?tab=${value}`}`);
      drawBody();
    }));
    drawBody();
  }

  function drawBody() {
    const draw = { overview: drawOverview, list: drawList, route: drawRoute, photos: drawPhotos }[tab];
    draw();
  }

  /* ── Overview ───────────────────────────────────── */

  /** An icon for a WMO weather code; `night` swaps the sun for the moon. */
  function skyIcon(code, night = false) {
    if (code === 0 || code === 1) return night ? "moon" : "sun";
    if (code === 2) return night ? "cloud" : "cloudSun";
    if (code === 3) return "cloud";
    if (code === 45 || code === 48) return "fog";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    if (code >= 51) return "rain";
    return "cloud";
  }

  const VERDICT_WORDS = { great: "Great day for it", good: "Good conditions", mixed: "Mixed conditions", poor: "Tough conditions" };
  const POINT_ICONS = { timing: "clock", wear: "thermometer", safety: "alert", comfort: "sun", road: "route" };

  function briefingBlock(slot) {
    if (!detail.model_ready) return;
    mount(slot, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Reading the forecast for your plan…"));
    api.briefing(eventId, imperial)
      .then((briefing) => {
        mount(slot,
          h("div", { class: `briefing briefing-${briefing.verdict}` },
            h("div", { class: "briefing-head" },
              h("span", { class: "verdict" }, VERDICT_WORDS[briefing.verdict] || briefing.verdict),
              h("span", { class: "badge badge-ai" }, icon("sparkles", "sm"), "Model briefing")),
            h("p", { class: "briefing-headline" }, briefing.headline),
            h("ul", { class: "briefing-points" }, briefing.points.map((point) =>
              h("li", {}, h("span", { class: `point-icon point-${point.kind}` }, icon(POINT_ICONS[point.kind] || "info", "sm")), h("span", {}, point.text))))));
      })
      .catch((error) => mount(slot, h("p", { class: "small muted" }, `No briefing right now: ${error.message}`)));
  }

  function hourStrip(forecast, startsAt) {
    const hours = forecast.hours || [];
    if (!hours.length) return null;
    const startHour = Math.floor(startsAt / 3600) * 3600;
    return h("div", { class: "hours", role: "list", "aria-label": "Hour by hour" }, hours.map((hour) => {
      const night = hour.time < forecast.sunrise - 1800 || hour.time >= forecast.sunset;
      const isStart = hour.time === startHour;
      const sunsetHere = forecast.sunset >= hour.time && forecast.sunset < hour.time + 3600;
      return h("div", { class: `hour${isStart ? " is-start" : ""}${night ? " is-night" : ""}`, role: "listitem" },
        h("span", { class: "hour-time" }, isStart ? "Start" : formatTime(hour.time).replace(":00", "")),
        h("span", { class: "hour-sky", title: `Code ${hour.weather_code}` }, icon(skyIcon(hour.weather_code, night))),
        h("span", { class: "hour-temp" }, temperature(hour.temp_c)),
        h("span", { class: "hour-rain", title: "Chance of rain" },
          h("span", { class: "rain-bar" }, h("span", { style: `height:${Math.max(2, Math.round(hour.precipitation_chance))}%` })),
          `${Math.round(hour.precipitation_chance)}%`),
        h("span", { class: "hour-wind", title: `Gusts ${speed(hour.gusts_kmh)}` }, speed(hour.wind_kmh)),
        sunsetHere ? h("span", { class: "hour-sunset" }, icon("sunset", "sm"), formatTime(forecast.sunset)) : null);
    }));
  }

  function weatherCard() {
    const { forecast, elevation_m: elevation, place_name: placeName } = detail.conditions;
    const briefingSlot = h("div");
    const facts = [];
    if (forecast) {
      facts.push(["thermometer", "High / low", `${temperature(forecast.max_temp_c)} / ${temperature(forecast.min_temp_c)}`]);
      facts.push(["sunset", "Daylight", `${formatTime(forecast.sunrise)} – ${formatTime(forecast.sunset)}`]);
      const levels = (forecast.hours || []).map((hour) => hour.freezing_level_m).filter((level) => level !== null && level !== undefined);
      if (levels.length && elevation !== null && elevation !== undefined && Math.min(...levels) < elevation + 600) {
        facts.push(["snow", "Freezing level", `${height(Math.min(...levels))} and up`]);
      }
      if (forecast.max_uv_index >= 3) facts.push(["sun", "UV index", forecast.max_uv_index.toFixed(0)]);
    }
    if (elevation !== null && elevation !== undefined) facts.push(["mountain", "Elevation", height(elevation)]);
    const card = h("section", { class: "card" },
      h("div", { class: "card-head" },
        h("div", {}, h("h3", {}, "Conditions"), h("div", { class: "small muted" }, `At ${placeName}`)),
        h("span", { class: "small muted" }, "Forecast: Open-Meteo")),
      h("div", { class: "card-body stack", style: "gap:16px" },
        briefingSlot,
        forecast ? hourStrip(forecast, detail.event.starts_at) : null,
        facts.length ? h("div", { class: "fact-row" }, facts.map(([iconName, label, value]) =>
          h("div", { class: "fact" }, icon(iconName, "sm"), h("span", { class: "muted" }, label), h("b", {}, value)))) : null,
        forecast ? null : h("p", { class: "small muted" }, "The hour-by-hour forecast appears about 16 days before the event.")));
    briefingBlock(briefingSlot);
    return card;
  }

  /** Directions through the meeting point, the stops everyone makes, and the venue. */
  function tripDirections() {
    const places = itinerary(detail.event, detail.stops).filter((place) => place.kind !== "optional");
    return itineraryUrl(places);
  }

  function itineraryList() {
    const places = itinerary(detail.event, detail.stops);
    const labels = pinLabels(places);
    return h("ol", { class: "itinerary" }, places.map((place, index) =>
      h("li", { class: `itin-${place.kind}` },
        h("span", { class: `loc-badge loc-badge-${place.kind}` }, labels[index]),
        h("div", { class: "grow" },
          h("div", { class: "tiny muted strong itin-kind" }, PLACE_KINDS[place.kind].label),
          h("div", { class: "strong" }, place.name),
          place.note ? h("div", { class: "small text-2" }, place.note) : null),
        h("a", { class: "btn btn-ghost btn-icon btn-sm", href: directionsUrl(place), target: "_blank", rel: "noopener", title: `Directions to ${place.name}`, "aria-label": `Directions to ${place.name}` }, icon("navigation", "sm")))));
  }

  /** Puts every place of the event on `map`, numbered, joined by a dashed line. */
  function drawItineraryPins(map) {
    const places = itinerary(detail.event, detail.stops);
    const labels = pinLabels(places);
    const layer = L.layerGroup().addTo(map);
    itineraryLine(layer, places);
    places.forEach((place, index) =>
      L.marker([place.lat, place.lng], { icon: placePin(place.kind, labels[index]) })
        .bindTooltip(`${PLACE_KINDS[place.kind].label}: ${place.name}`, { direction: "top", offset: [0, -30] })
        .addTo(layer));
    return places;
  }

  function drawOverview() {
    const { event, attendees } = detail;
    const mapElement = h("div", { class: `map ${detail.stops.length ? "map-md" : "map-sm"}` });
    mount(bodySlot,
      h("div", { class: "split", style: "margin-top:24px" },
        h("div", { class: "stack-lg" },
          h("section", { class: "card" },
            h("div", { class: "card-head" }, h("h3", {}, "About"),
              detail.can_manage ? h("a", { class: "btn btn-ghost btn-sm", href: `#/events/${eventId}/edit` }, icon("edit", "sm"), "Edit") : null),
            h("div", { class: "card-body" },
              event.description
                ? renderMarkdown(event.description)
                : h("p", { class: "muted" }, detail.can_manage ? "No description yet. Add details so people know what to expect." : "No description."))),
          weatherCard(),
          h("section", { class: "card" },
            h("div", { class: "card-head" }, h("h3", {}, `Going · ${attendees.length}`)),
            h("div", { class: "card-body" },
              attendees.length
                ? h("div", { class: "people-grid" }, attendees.map((person) =>
                    h("a", { class: "person", href: `#/people/${person.user_id}` }, avatar(person.name, 32, person.avatar), h("span", {}, person.user_id === me.id ? `${person.name} (you)` : person.name))))
                : h("p", { class: "muted" }, "Nobody yet. Be the first.")))),
        h("aside", { class: "sticky-col" },
          h("section", { class: "card" },
            h("div", { class: "card-body stack" },
              h("div", { class: "info-list" },
                h("div", { class: "info-item" }, h("span", { class: "info-icon" }, icon("calendar")),
                  h("div", {}, h("div", { class: "strong" }, formatLongDay(event.starts_at)), h("div", { class: "small muted" }, `${formatTime(event.starts_at)} · ${relativeTime(event.starts_at)}`))),
              ),
              itineraryList(),
              mapElement,
              h("div", { class: "row" },
                h("a", { class: "btn btn-sm grow", href: tripDirections(), target: "_blank", rel: "noopener" }, icon("navigation", "sm"), detail.stops.length ? "Trip directions" : "Directions"),
                h("button", { type: "button", class: "btn btn-sm grow", onclick: () => downloadCalendarFile(event) }, icon("download", "sm"), "Add to calendar")))),
          h("section", { class: "card" },
            h("div", { class: "card-body stack" },
              h("div", { class: "row-between" }, h("h3", {}, "Packing list"), h("span", { class: "small muted" }, `${detail.items.length} items`)),
              detail.items.length
                ? h("div", { class: "progress" }, h("span", { style: `width:${Math.round((sortedCount() / detail.items.length) * 100)}%` }))
                : null,
              h("p", { class: "small text-2" }, detail.items.length
                ? `${sortedCount()} of ${detail.items.length} sorted for you.`
                : "Nothing on the list yet."),
              h("button", { type: "button", class: "btn btn-sm", onclick: () => switchTo("list") }, "Open the list", icon("arrowRight", "sm")))))));
    const map = createMap(mapElement, event, 13);
    const places = drawItineraryPins(map);
    if (places.length > 1) fitTo(map, places, 30);
  }

  function switchTo(value) {
    tab = value;
    replaceRoute(`/events/${eventId}${value === "overview" ? "" : `?tab=${value}`}`);
    drawTabs();
    tabsSlot.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Packing list ───────────────────────────────── */

  function mine(item) {
    return item.marks.find((mark) => mark.user_id === me.id) || null;
  }

  function isSortedForMe(item) {
    if (item.scope === "shared") return item.marks.length > 0;
    return mine(item)?.state === "got";
  }

  function sortedCount() {
    return detail.items.filter(isSortedForMe).length;
  }

  async function setMark(item, state) {
    await api.mark(item.id, state);
    detail = await api.event(eventId);
    drawTabs();
  }

  function itemRow(item) {
    const myMark = mine(item);
    const got = item.marks.filter((mark) => mark.state === "got");
    const bringing = item.marks.filter((mark) => mark.state === "bringing");
    const goingCount = Math.max(detail.event.going_count, 1);
    const canMark = detail.is_member;
    const someoneElse = item.scope === "shared" && item.marks.length > 0 && !myMark;
    const checked = item.scope === "shared" ? got.length > 0 : myMark?.state === "got";

    const check = h("button", {
      type: "button",
      class: `check${checked ? " on" : ""}`,
      "aria-pressed": checked ? "true" : "false",
      "aria-label": checked ? `Mark ${item.name} as not got` : `Mark ${item.name} as got`,
      title: someoneElse ? "Someone else has this covered" : checked ? "Undo" : item.scope === "shared" ? "I got this for the group" : "I have this",
      disabled: !canMark || someoneElse ? true : null,
      onclick: async () => {
        try {
          await setMark(item, checked ? null : "got");
        } catch (error) {
          toast(error.message, "error");
        }
      },
    }, icon("check"));

    let status;
    if (item.scope === "shared") {
      if (got.length) status = h("span", { class: "badge badge-accent" }, `Bought by ${got[0].user_id === me.id ? "you" : got[0].name}`);
      else if (bringing.length) status = h("span", { class: "badge badge-warning" }, `${bringing[0].user_id === me.id ? "You're" : `${bringing[0].name} is`} bringing it`);
      else status = h("span", { class: "badge" }, "Nobody yet");
    } else {
      status = h("span", {}, `${got.length} of ${goingCount} going have it`);
    }

    const sideButtons = [];
    if (canMark && item.scope === "shared" && !item.marks.length) {
      sideButtons.push(actionButton("I'll bring it", () => setMark(item, "bringing"), { class: "btn btn-sm" }));
    }
    if (canMark && item.scope === "shared" && myMark?.state === "bringing") {
      sideButtons.push(actionButton("Drop", () => setMark(item, null), { class: "btn btn-sm btn-ghost" }));
    }
    const canRemove = me.is_admin || item.added_by === me.id || detail.can_manage;
    if (canRemove) {
      sideButtons.push(dropdown(h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": `More for ${item.name}` }, icon("more")), () => [
        menuItem("trash", "Remove from list", async () => {
          try {
            await api.removeItem(item.id);
            detail = await api.event(eventId);
            drawTabs();
          } catch (error) {
            toast(error.message, "error");
          }
        }, { class: "menu-danger" }),
      ]));
    }

    return h("li", { class: `item${checked ? " done" : ""}` },
      check,
      h("div", { style: "min-width:0" },
        h("div", { class: "item-name" },
          h("span", {}, item.name),
          item.quantity > 1 ? h("span", { class: "badge" }, `×${item.quantity}`) : null,
          item.source === "model" ? h("span", { class: "badge badge-ai", title: "Suggested by the planning model" }, icon("sparkles", "sm"), "Suggested") : null),
        item.why ? h("p", { class: "item-why" }, item.why) : null,
        h("div", { class: "item-meta" },
          status,
          item.marks.length ? avatarStack(item.marks, 22, 6) : null,
          item.shop_tags.length ? h("span", {}, `Sold at ${item.shop_tags.map((tag) => tag.replace(/_/g, " ")).join(", ")} shops`) : null),
        item.often_with?.length
          ? h("p", { class: "often" }, "Groups who bought this also got ", h("b", {}, item.often_with.map((pairing) => pairing.item).join(", ")))
          : null),
      h("div", { class: "item-side" }, sideButtons));
  }

  function askBox() {
    const input = h("input", { type: "search", placeholder: "e.g. my feet get cold", maxlength: 200 });
    const results = h("div");
    const form = h("form", { class: "stack" },
      h("div", { class: "ask" },
        h("div", { class: "input-wrap" }, icon("sparkles"), input),
        h("button", { type: "submit", class: "btn btn-primary" }, "Ask")),
      results);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      mount(results, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Thinking about your trip…"));
      try {
        const found = await api.find(eventId, query);
        const listed = new Set(detail.items.map((item) => item.name.toLowerCase()));
        mount(results, found.items.length
          ? h("div", { class: "suggest-list" },
              found.items.map((item) =>
                h("div", { class: "suggest" },
                  h("div", { style: "min-width:0" },
                    h("div", { class: "strong" }, item.name),
                    h("p", { class: "item-why" }, item.why)),
                  listed.has(item.name.toLowerCase())
                    ? h("span", { class: "badge badge-accent" }, "On the list")
                    : detail.is_member
                      ? actionButton([icon("plus", "sm"), "Add"], async () => {
                          await api.addItem(eventId, item);
                          toast(`Added ${item.name}`, "success");
                          detail = await api.event(eventId);
                          drawTabs();
                        }, { class: "btn btn-sm" })
                      : null)),
              found.trip.stores.length
                ? h("button", { type: "button", class: "btn btn-sm", style: "align-self:flex-start", onclick: () => switchTo("route") }, icon("store", "sm"), `See ${found.trip.stores.length} stores on your way`)
                : null)
          : h("p", { class: "small muted" }, "Nothing came up. Try describing it differently."));
      } catch (error) {
        mount(results, h("p", { class: "small", style: "color:var(--danger)" }, error.message));
      }
    });
    return form;
  }

  function drawList() {
    const items = detail.items;
    const shared = items.filter((item) => item.scope === "shared");
    const personal = items.filter((item) => item.scope === "personal");
    const sorted = sortedCount();

    const suggest = detail.model_ready && detail.is_member
      ? actionButton([icon("sparkles"), items.length ? "Suggest more" : "Suggest items"], async (button) => {
          button.replaceChildren(h("span", { class: "spinner" }), "Reading the plan, forecast and route…");
          const result = await api.plan(eventId);
          toast(result.added ? `Added ${result.added} suggestions` : "No new suggestions", result.added ? "success" : "info");
          detail = await api.event(eventId);
          drawTabs();
        }, { class: items.length ? "btn" : "btn btn-primary" })
      : null;

    const addInput = h("input", { placeholder: "Add an item, e.g. bear spray", maxlength: 80, "aria-label": "Item name" });
    const scope = h("select", { "aria-label": "Who brings it" },
      h("option", { value: "personal" }, "Everyone brings one"),
      h("option", { value: "shared" }, "One for the group"));
    const addForm = h("form", { class: "add-row" }, addInput, scope, h("button", { type: "submit", class: "btn" }, icon("plus", "sm"), "Add"));
    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = addInput.value.trim();
      if (!name) {
        addInput.focus();
        return;
      }
      try {
        await api.addItem(eventId, { name, scope: scope.value });
        detail = await api.event(eventId);
        drawTabs();
        bodySlot.querySelector(".add-row input")?.focus();
      } catch (error) {
        toast(error.message, "error");
      }
    });

    const group = (title, text, list) =>
      list.length
        ? h("section", {},
            h("div", { class: "row-between", style: "margin-bottom:2px" }, h("h4", {}, title), h("span", { class: "small muted" }, text)),
            h("ul", { class: "items" }, list.map(itemRow)))
        : null;

    mount(bodySlot,
      h("div", { class: "split", style: "margin-top:24px" },
        h("div", { class: "stack-lg" },
          h("section", { class: "card" },
            h("div", { class: "card-head" },
              h("div", {}, h("h3", {}, "Packing list"),
                h("p", { class: "small muted", style: "margin-top:2px" }, items.length ? `${sorted} of ${items.length} sorted for you` : "Shared by everyone going")),
              suggest),
            h("div", { class: "card-body stack-lg" },
              items.length ? h("div", { class: "progress" }, h("span", { style: `width:${Math.round((sorted / items.length) * 100)}%` })) : null,
              items.length
                ? [group("For the group", "One person brings it", shared), group("Everyone brings their own", "Tick it when you have it", personal)]
                : emptyState("list", "The list is empty",
                    detail.model_ready
                      ? "Get suggestions from the plan, the forecast at the meeting point and the drive, or add your own."
                      : "Add what the group should bring."),
              detail.is_member ? addForm : h("p", { class: "small muted" }, "Say you're going to add items and tick them off.")))),
        h("aside", { class: "sticky-col" },
          detail.model_ready && detail.is_member
            ? h("section", { class: "card" },
                h("div", { class: "card-head" }, h("h3", {}, "Ask for ideas")),
                h("div", { class: "card-body stack" },
                  h("p", { class: "small text-2" }, "Describe a need in your own words, like “my feet get cold” or “snacks kids like”. The model suggests items for this trip, and the map finds stores on your way."),
                  askBox()))
            : null,
          h("section", { class: "card" },
            h("div", { class: "card-body stack" },
              h("h4", {}, "How it works"),
              h("p", { class: "small text-2" }, "Tick what you have. Items for the group need just one person: press “I'll bring it” to claim one, and tick it once it's bought. Everyone going sees who has what."))))));
  }

  /* ── Getting there ──────────────────────────────── */

  function drawRoute() {
    const { event } = detail;
    const mapElement = h("div", { class: "map map-lg" });
    const tripSlot = h("div", { class: "stack" });
    const startSlot = h("div", { class: "stack" });
    mount(bodySlot,
      h("div", { class: "split-wide", style: "margin-top:24px" },
        h("div", { class: "stack-lg" }, h("div", { class: "card", style: "padding:6px" }, mapElement)),
        h("aside", { class: "stack-lg" },
          h("section", { class: "card" },
            h("div", { class: "card-head" }, h("h3", {}, "Your starting point")),
            h("div", { class: "card-body" }, startSlot)),
          h("section", { class: "card" },
            h("div", { class: "card-head" }, h("h3", {}, "Stores on your way")),
            h("div", { class: "card-body" }, tripSlot)))));

    const map = createMap(mapElement, event, 11);
    drawItineraryPins(map);
    let tripLayer = L.layerGroup().addTo(map);
    let originMarker = null;
    let picking = false;

    function drawOrigin() {
      originMarker?.remove();
      originMarker = detail.my_origin
        ? L.marker([detail.my_origin.lat, detail.my_origin.lng], { icon: pin("start") }).addTo(map).bindTooltip("You start here")
        : null;
    }

    async function saveOrigin(point) {
      await api.setOrigin(eventId, point);
      detail.my_origin = point;
      drawOrigin();
      drawStart();
      loadTrip();
    }

    function drawTrip(trip) {
      tripLayer.remove();
      tripLayer = L.layerGroup().addTo(map);
      const points = [{ lat: event.lat, lng: event.lng }];
      if (trip.route) {
        routeLine(tripLayer, trip.route.points);
        points.push(...trip.route.points);
      }
      if (detail.my_origin) points.push(detail.my_origin);
      trip.stores.forEach((stop, index) => {
        L.marker([stop.store.lat, stop.store.lng], { icon: pin("store", index + 1) }).addTo(tripLayer)
          .bindPopup(() => h("div", {},
            h("div", { class: "strong" }, stop.store.name),
            h("div", { class: "small muted" }, `${stop.store.shop_tag.replace(/_/g, " ")} · ${detourText(stop.detour_minutes)}`),
            h("div", { class: "small" }, `For: ${stop.covers.join(", ")}`)));
        points.push({ lat: stop.store.lat, lng: stop.store.lng });
      });
      fitTo(map, points);

      const needsSomething = detail.items.some((item) => !isSortedForMe(item));
      mount(tripSlot,
        trip.notice ? h("div", { class: "badge-warning", style: "padding:10px 12px;border-radius:8px;font-size:13px;display:flex;gap:8px" }, icon("info", "sm"), h("span", {}, trip.notice)) : null,
        trip.route
          ? h("div", { class: "info-item", style: "padding-top:0" }, h("span", { class: "info-icon" }, icon("route")),
              h("div", {}, h("div", { class: "strong" }, `${duration(trip.route.duration_minutes)} drive`), h("div", { class: "small muted" }, `${distance(trip.route.distance_km)} to the meeting point`)))
          : null,
        trip.stores.length
          ? h("ol", { class: "stops" }, trip.stores.map((stop, index) =>
              h("li", { class: "stop" },
                h("span", { class: "stop-n" }, String(index + 1)),
                h("div", { style: "min-width:0" },
                  h("div", { class: "stop-title" },
                    h("span", { class: "strong ellipsis" }, stop.store.name),
                    h("span", { class: "detour", title: stop.detour_is_estimate ? "Estimated from distance" : "Driving time added" }, `${detourText(stop.detour_minutes)}${stop.detour_is_estimate ? " (est.)" : ""}`)),
                  h("div", { class: "small muted" }, [stop.store.shop_tag.replace(/_/g, " "), stop.store.address].filter(Boolean).join(" · ")),
                  h("div", { class: "chips" }, stop.covers.map((name) => h("span", { class: "chip" }, name))),
                  stop.store.opening_hours ? h("div", { class: "tiny muted", style: "margin-top:4px" }, stop.store.opening_hours) : null,
                  h("div", { class: "row", style: "margin-top:6px;gap:12px" },
                    h("a", { class: "small strong", href: directionsUrl(stop.store, detail.my_origin), target: "_blank", rel: "noopener" }, "Directions"),
                    h("a", { class: "small", href: `https://www.openstreetmap.org/${stop.store.osm_ref}`, target: "_blank", rel: "noopener" }, "Details"))))))
          : h("p", { class: "small muted" },
              !detail.items.length ? "Stores appear here once the packing list has items."
                : !needsSomething ? "You're all set: everything on the list is sorted."
                  : "No matching stores found nearby."),
        h("p", { class: "tiny muted" }, "Stores from OpenStreetMap. Detours are driving times from OSRM."));
    }

    const loadTrip = debounce(async () => {
      if (!detail.items.length) {
        drawTrip({ route: null, stores: [] });
        return;
      }
      mount(tripSlot, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Looking for stores along your route…"));
      try {
        drawTrip(await api.trip(eventId));
      } catch (error) {
        mount(tripSlot, h("p", { class: "small", style: "color:var(--danger)" }, error.message));
      }
    }, 250);

    function drawStart() {
      const input = h("input", { type: "search", placeholder: "Search an address or town", autocomplete: "off" });
      const list = h("ul", { class: "combo-list", hidden: true });
      const search = debounce(async (text) => {
        if (text.trim().length < 3) {
          list.hidden = true;
          return;
        }
        try {
          const places = await api.places(text, event);
          mount(list, places.length
            ? places.map((place) => h("li", {
                onmousedown: async (clicked) => {
                  clicked.preventDefault();
                  list.hidden = true;
                  input.value = place.name;
                  try {
                    await saveOrigin({ lat: place.lat, lng: place.lng });
                  } catch (error) {
                    toast(error.message, "error");
                  }
                },
              }, icon("pin"), h("div", {}, h("div", { class: "strong" }, place.name), h("div", { class: "small" }, place.detail))))
            : h("li", { class: "combo-note" }, "No places found"));
          list.hidden = false;
        } catch (error) {
          mount(list, h("li", { class: "combo-note" }, error.message));
          list.hidden = false;
        }
      }, 280);
      input.addEventListener("input", () => search(input.value));
      input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 120));

      const pickButton = h("button", { type: "button", class: "btn btn-sm" }, icon("pin", "sm"), "Pick on map");
      pickButton.addEventListener("click", () => {
        picking = !picking;
        pickButton.classList.toggle("btn-soft", picking);
        mapElement.parentElement.classList.toggle("map-picking", picking);
        if (picking) toast("Click the map where you'll set off from");
      });

      mount(startSlot,
        detail.my_origin
          ? h("div", { class: "picked" }, icon("navigation"), h("div", { class: "grow" }, h("div", { class: "strong" }, "Starting point set"), h("div", { class: "small" }, "The route and store detours start here.")),
              actionButton("Clear", async () => {
                await api.clearOrigin(eventId);
                detail.my_origin = null;
                drawOrigin();
                drawStart();
                loadTrip();
              }, { class: "btn btn-sm btn-ghost" }))
          : h("p", { class: "small text-2" }, "Add where you'll leave from to see your route and stores along it. Without it, stores near the meeting point are shown."),
        h("div", { class: "combo" }, h("div", { class: "input-wrap" }, icon("search"), input), list),
        h("div", { class: "row" },
          actionButton([icon("locate", "sm"), "Use my location"], async () => saveOrigin(await currentPosition()), { class: "btn btn-sm" }),
          pickButton),
        h("p", { class: "tiny muted" }, "Only you see your starting point. It's deleted a day after the event."));
    }

    map.on("click", async (clicked) => {
      if (!picking) return;
      picking = false;
      mapElement.parentElement.classList.remove("map-picking");
      try {
        await saveOrigin({ lat: clicked.latlng.lat, lng: clicked.latlng.lng });
      } catch (error) {
        toast(error.message, "error");
      }
    });

    drawOrigin();
    drawStart();
    loadTrip();
  }

  /* ── Photos ─────────────────────────────────────── */

  function openPhoto(index) {
    let current = index;
    openModal({
      title: "Photo",
      wide: true,
      build: (close) => {
        const holder = h("div", { class: "stack" });
        function draw() {
          const photo = detail.photos[current];
          const canDelete = photo.uploader_id === me.id || detail.can_manage;
          mount(holder,
            h("div", { style: "position:relative;background:#0b0d0c;border-radius:10px;overflow:hidden" },
              h("img", { src: pictureUrl(photo.id), alt: photo.caption || `Photo by ${photo.uploader_name}`, style: "max-height:70vh;margin:0 auto;object-fit:contain" }),
              current > 0 ? h("button", { type: "button", class: "btn btn-overlay btn-icon lightbox-nav", style: "left:10px", "aria-label": "Previous", onclick: () => { current -= 1; draw(); } }, icon("chevronLeft")) : null,
              current < detail.photos.length - 1 ? h("button", { type: "button", class: "btn btn-overlay btn-icon lightbox-nav", style: "right:10px", "aria-label": "Next", onclick: () => { current += 1; draw(); } }, icon("chevronRight")) : null),
            h("div", { class: "row-between" },
              h("div", { class: "row" }, avatar(photo.uploader_name, 30, photo.uploader_avatar),
                h("div", {}, h("div", { class: "strong small" }, photo.uploader_name), h("div", { class: "tiny muted" }, relativeTime(photo.created_at)))),
              h("div", { class: "row" },
                h("a", { class: "btn btn-sm", href: pictureUrl(photo.id), download: `photo-${photo.id.slice(0, 8)}.jpg` }, icon("download", "sm"), "Download"),
                canDelete
                  ? actionButton([icon("trash", "sm"), "Delete"], async () => {
                      detail.photos = await api.removePhoto(photo.id);
                      toast("Photo deleted");
                      drawTabs();
                      close();
                    }, { class: "btn btn-sm btn-danger" })
                  : null)),
            photo.caption ? h("p", { class: "text-2" }, photo.caption) : null);
        }
        draw();
        return holder;
      },
    });
  }

  function drawPhotos() {
    const progress = h("div", { class: "upload-progress", hidden: true });
    const add = detail.is_member
      ? h("button", {
          type: "button",
          class: "btn btn-primary",
          onclick: async () => {
            const files = await choosePictures(true);
            if (!files.length) return;
            add.disabled = true;
            progress.hidden = false;
            let done = 0;
            let failed = 0;
            for (const file of files) {
              mount(progress, h("span", { class: "spinner" }), `Uploading ${done + failed + 1} of ${files.length}…`);
              const problem = pictureProblem(file);
              try {
                if (problem) throw new Error(problem);
                detail.photos = await api.addPhoto(eventId, file);
                done += 1;
              } catch (error) {
                failed += 1;
                toast(`${file.name}: ${error.message}`, "error");
              }
            }
            if (done) toast(`Added ${done} ${done === 1 ? "photo" : "photos"}`, "success");
            drawTabs();
          },
        }, icon("upload"), "Add photos")
      : null;

    mount(bodySlot,
      h("section", { class: "card", style: "margin-top:24px" },
        h("div", { class: "card-head" },
          h("div", {}, h("h3", {}, "Photos"), h("p", { class: "small muted", style: "margin-top:2px" }, "Shared by people in the tribe. Location data is removed from every upload.")),
          add),
        h("div", { class: "card-body stack" },
          progress,
          detail.photos.length
            ? h("div", { class: "gallery" }, detail.photos.map((photo, index) =>
                h("button", { type: "button", "aria-label": photo.caption || `Photo by ${photo.uploader_name}`, onclick: () => openPhoto(index) },
                  h("img", { src: pictureUrl(photo.id, true), alt: "", loading: "lazy" }))))
            : emptyState("camera", "No photos yet",
                detail.is_member ? "Share photos from the outing so everyone has them." : "Members of the tribe can share photos here."))));
  }

  drawHero();
  mount(view, heroSlot, h("div", {}, tabsSlot, bodySlot));
  drawTabs();
}
