// Writes every figure in the book from the drawing kit, so they share one
// look and every arrow meets the boxes it joins. Check the result with
// tools/audit.mjs.
// Usage: node book/tools/figures.mjs

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FAINT, HUE, INK, LINE, MUTED, TOP, across, arrow, card, down, edges, figure, icon, pill, region, text } from "./kit.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { coverSvg } = await import(join(repo, "web", "dist", "cover_art.js"));

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "figures");

/** Every figure, by file name. */
const FIGURES = {};

/** The width a card would have, for centring it before drawing it. */
function widthOf(options) {
  return card({ ...options, x: 0, y: 0 }).box.w;
}

/** Cards in a row, `gap` apart, centred on `middle`; returns the drawn cards. */
function row(middle, y, gap, cards) {
  const widths = cards.map((options) => options.w ?? widthOf(options));
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (cards.length - 1);
  let x = middle - total / 2;

  return cards.map((options, index) => {
    const drawn = card({ ...options, x, y, w: widths[index] });
    x += widths[index] + gap;
    return drawn;
  });
}

function svgOf(cards) {
  return cards.map((drawn) => drawn.svg).join("");
}

/* ── Chapter 1 ────────────────────────────────────── */

FIGURES["ch01-system.svg"] = () => {
  const width = 1000;
  const middle = width / 2;

  const [browser] = row(middle, TOP + 10, 0, [{ title: "Your browser", lines: ["The web app: 47 TypeScript modules", "Map tiles straight from OpenStreetMap"], hue: "orange", icon: "monitor" }]);

  const thorTop = TOP + 150;
  const [server] = row(middle, thorTop + 70, 0, [{ title: "ourlittletribe", lines: ["One Rust binary on 127.0.0.1:8090", "JSON under /api, pictures under /media"], hue: "green", icon: "logoPeak", w: 320 }]);
  const database = card({ x: 64, y: thorTop + 46, w: 220, title: "SQLite file", lines: ["ourlittletribe.db, WAL"], hue: "gold", icon: "list" });
  const pictures = card({ x: 64, y: thorTop + 136, w: 220, title: "Pictures folder", lines: ["{id}.jpg, {id}_s.jpg"], hue: "gold", icon: "image" });
  const model = card({ x: width - 64 - 250, y: thorTop + 70, w: 250, title: "TensorRT Edge-LLM", lines: ["Qwen3.6 35B-A3B, NVFP4", "127.0.0.1:8081"], hue: "purple", icon: "sparkles" });

  const thor = region({ x: 32, y: thorTop, w: width - 64, h: 240, label: "Jetson AGX Thor", hue: "green" });
  const links = [
    down(browser.box, server.box, { hue: "orange", label: "HTTPS through Tailscale Funnel", labelAt: { x: middle, y: (browser.box.bottom.y + thorTop) / 2 + 4 } }),
    arrow([server.box.left, { x: database.box.right.x + 30, y: server.box.left.y }, { x: database.box.right.x + 30, y: database.box.right.y }, database.box.right], { hue: "gold" }),
    arrow([{ x: database.box.right.x + 30, y: server.box.left.y }, { x: database.box.right.x + 30, y: pictures.box.right.y }, pictures.box.right], { hue: "gold" }),
    across(server.box, model.box, { hue: "purple" }),
  ];

  const servicesY = thorTop + 300;
  const services = row(middle, servicesY, 18, [
    { title: "Photon", lines: ["places as you type"], hue: "blue", w: 166 },
    { title: "Nominatim", lines: ["places, fallback"], hue: "blue", w: 166 },
    { title: "Open-Meteo", lines: ["forecast, elevation"], hue: "blue", w: 166 },
    { title: "OSRM", lines: ["driving routes"], hue: "blue", w: 166 },
    { title: "Overpass", lines: ["shops by kind"], hue: "blue", w: 166 },
  ]);
  const busY = servicesY - 26;
  const bus = `<path d="M${server.box.bottom.x} ${server.box.bottom.y} V${busY} M${services[0].box.top.x} ${busY} H${services[4].box.top.x}" stroke="${HUE.blue.strong}" stroke-width="1.8" fill="none"/>`;
  const drops = services.map((service) => arrow([{ x: service.box.top.x, y: busY }, service.box.top], { hue: "blue" })).join("");
  const busLabel = text(services[4].box.right.x, busY - 10, "public services, HTTPS, no keys", { size: 12, fill: MUTED, anchor: "end" });

  return figure({ width, height: servicesY + 100, title: "One machine runs the app and its model", subtitle: "The browser talks to one binary; the binary keeps two kinds of storage and asks five public services." },
    thor + svgOf([browser, server, database, pictures, model]) + links.join("") + bus + drops + busLabel + svgOf(services));
};

FIGURES["ch01-crates.svg"] = () => {
  const width = 1060;
  const middle = width / 2;

  const [server] = row(middle, TOP + 10, 0, [{ title: "tribe-server", lines: ["routes, sessions, caches, search, trips · 4,436 lines"], hue: "green", icon: "logoPeak" }]);
  const middleRow = row(middle, TOP + 150, 18, [
    { title: "tribe-db", lines: ["schema, queries", "3,144 lines"], hue: "gold", icon: "list", w: 226 },
    { title: "tribe-places", lines: ["five map services", "1,644 lines"], hue: "blue", icon: "map", w: 226 },
    { title: "tribe-brain", lines: ["prompts, schemas, checks", "1,601 lines"], hue: "purple", icon: "sparkles", w: 236 },
    { title: "tribe-media", lines: ["decode, resize, store", "367 lines"], hue: "slate", icon: "image", w: 226 },
  ]);
  const [core] = row(middle - 115, TOP + 300, 0, [{ title: "tribe-core", lines: ["geometry, ranking, baskets, time · no I/O · 833 lines"], hue: "green", icon: "gauge" }]);

  const fromServer = middleRow.map((crate) => down(server.box, crate.box, { hue: "green" })).join("");
  const toCore = middleRow.slice(0, 3).map((crate) => down(crate.box, core.box, { hue: "slate" })).join("");
  const note = text(middleRow[3].box.bottom.x, middleRow[3].box.bottom.y + 30, "uses nothing else", { size: 12, fill: FAINT, anchor: "middle", italic: true });

  return figure({ width, height: TOP + 400, title: "Six crates; decisions sit apart from I/O", subtitle: "An arrow means \"depends on\". tribe-core decides things and touches nothing outside memory." },
    fromServer + toCore + svgOf([server, ...middleRow, core]) + note);
};

FIGURES["ch01-request.svg"] = () => {
  const width = 1000;
  const lanes = [
    { name: "Browser", hue: "orange", icon: "monitor" },
    { name: "Server", hue: "green", icon: "logoPeak" },
    { name: "SQLite", hue: "gold", icon: "list" },
    { name: "Open-Meteo", hue: "blue", icon: "cloudSun" },
    { name: "Model", hue: "purple", icon: "sparkles" },
  ];
  const step = (width - 120) / (lanes.length - 1);
  const xs = lanes.map((_, index) => 60 + index * step);
  const bottom = TOP + 425;

  const heads = lanes.map((lane, index) => {
    const label = pill(xs[index], TOP + 18, lane.name, { hue: lane.hue, anchor: "middle", size: 13 });
    const line = `<path d="M${xs[index]} ${TOP + 32} V${bottom}" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="4 5"/>`;
    return line + label.svg;
  }).join("");

  const messages = [
    { from: 0, to: 1, y: TOP + 70, words: "1  GET /api/events/{id}" },
    { from: 1, to: 2, y: TOP + 120, words: "2  everything in one call" },
    { from: 1, to: 3, y: TOP + 170, words: "3  forecast at the venue (cached 30 min)" },
    { from: 1, to: 0, y: TOP + 220, words: "4  EventDetail: the page draws" },
    { from: 0, to: 1, y: TOP + 300, words: "5  GET …/briefing?units=imperial" },
    { from: 1, to: 4, y: TOP + 350, words: "6  write_briefing (4.5 s; cached 1 h)" },
    { from: 1, to: 0, y: TOP + 400, words: "7  Briefing: the card fills in" },
  ];
  const drawn = messages.map((message) => {
    const start = { x: xs[message.from], y: message.y };
    const end = { x: xs[message.to] + (message.to > message.from ? -2 : 2), y: message.y };
    const hue = lanes[message.to > message.from ? message.to : message.from].hue;
    const left = Math.min(start.x, end.x);
    return arrow([start, end], { hue }) + text(left + 10, message.y - 8, message.words, { size: 12.5, fill: INK });
  }).join("");

  const pause = `<rect x="40" y="${TOP + 240}" width="${width - 80}" height="34" rx="8" fill="${HUE.slate.soft}" fill-opacity=".6"/>`
    + text(width / 2, TOP + 262, "the page is already on screen while the model writes", { size: 12.5, fill: MUTED, anchor: "middle", italic: true });

  return figure({ width, height: bottom + 30, title: "Opening an event takes two requests", subtitle: "The details answer at once; the model's briefing follows a few seconds later." },
    heads + pause + drawn);
};

/* ── Chapter 2 ────────────────────────────────────── */

FIGURES["ch02-tables.svg"] = () => {
  const width = 1044;
  const column = (x, y, tables) => {
    let top = y;
    return tables.map((table) => {
      const drawn = card({ ...table, icon: null, x, y: top, w: 236, mono: true, titleSize: 14 });
      top += drawn.box.h + 14;
      return drawn;
    });
  };

  const people = column(32, TOP + 10, [
    { title: "users", lines: ["email: unique, any case", "password_hash: Argon2id", "avatar_image, cover_image"], hue: "orange", icon: "user" },
    { title: "sessions", lines: ["token_hash: SHA-256", "user_id → users", "expires_at"], hue: "orange", icon: "user" },
    { title: "tribes", lines: ["name, home_area", "creator_id → users"], hue: "green", icon: "users" },
    { title: "tribe_members", lines: ["tribe_id → tribes", "user_id → users", "role: organizer|member"], hue: "green", icon: "users" },
  ]);
  const events = column(32 + 248, TOP + 10, [
    { title: "events", lines: ["tribe_id → tribes", "place_name, lat, lng", "starts_at, tz_offset"], hue: "blue", icon: "calendar" },
    { title: "event_stops", lines: ["event_id → events", "kind: stop|optional|venue", "position"], hue: "blue", icon: "pin" },
    { title: "event_rsvps", lines: ["event_id → events", "status: going|not_going"], hue: "blue", icon: "check" },
    { title: "event_votes", lines: ["event_id → events", "vote: -1 | 1"], hue: "blue", icon: "heart" },
  ]);
  const lists = column(32 + 496, TOP + 10, [
    { title: "prep_items", lines: ["event_id → events", "scope: personal|shared", "source: model|person"], hue: "gold", icon: "listChecks" },
    { title: "item_marks", lines: ["item_id → prep_items", "user_id → users", "state: bringing|got"], hue: "gold", icon: "check" },
    { title: "trip_origins", lines: ["event_id → events", "lat, lng: yours only"], hue: "gold", icon: "navigation" },
  ]);
  const rest = column(32 + 744, TOP + 10, [
    { title: "images", lines: ["event_id or tribe_id", "purpose: cover|photo", "uploader_id → users"], hue: "purple", icon: "image" },
    { title: "inline_images", lines: ["uploader_id → users"], hue: "purple", icon: "image" },
    { title: "stores", lines: ["osm_ref, shop_tag", "shared by every route"], hue: "slate", icon: "store" },
    { title: "activity_log", lines: ["user_id → users", "target_type, target_id"], hue: "slate", icon: "feed" },
  ]);

  const all = [...people, ...events, ...lists, ...rest];
  const height = Math.max(...all.map((drawn) => drawn.box.y + drawn.box.h)) + 34;
  return figure({ width, height, title: "Fifteen tables, one file", subtitle: "An arrow inside a card is a foreign key; deleting the row it points to deletes or clears this one." }, svgOf(all));
};

FIGURES["ch02-pairings.svg"] = () => {
  const width = 1000;
  const left = 60;
  const barWidth = 520;
  const rows = [
    { label: "baskets (finished lists)", value: 20, of: 20, hue: "slate" },
    { label: "with microspikes", value: 8, of: 20, hue: "blue" },
    { label: "with hand warmers", value: 6, of: 20, hue: "orange" },
    { label: "with both", value: 5, of: 20, hue: "green" },
  ];

  const bars = rows.map((entry, index) => {
    const y = TOP + 20 + index * 44;
    const filled = (entry.value / entry.of) * barWidth;
    return text(left, y + 15, entry.label, { size: 13 })
      + `<rect x="${left + 190}" y="${y}" width="${barWidth}" height="22" rx="6" fill="${HUE[entry.hue].soft}"/>`
      + `<rect x="${left + 190}" y="${y}" width="${filled}" height="22" rx="6" fill="${HUE[entry.hue].strong}"/>`
      + text(left + 190 + barWidth + 14, y + 16, String(entry.value), { size: 13, weight: 650, mono: true });
  }).join("");

  const cardsY = TOP + 210;
  const results = row(width / 2, cardsY, 18, [
    { title: "support = 5 / 20 = 0.25", lines: ["share of baskets with both"], hue: "green", w: 290 },
    { title: "confidence = 5 / 8 = 0.63", lines: ["of baskets with microspikes,", "the share that also have warmers"], hue: "blue", w: 290 },
    { title: "lift = 0.63 / 0.30 = 2.08", lines: ["above 1: together more often", "than chance (needs ≥ 1.1)"], hue: "orange", w: 290 },
  ]);

  return figure({ width, height: cardsY + 120, title: "\"Groups often also got\" comes from counting", subtitle: "A worked example with made-up numbers: is a basket with microspikes likelier to hold hand warmers?" }, bars + svgOf(results));
};

/* ── Chapter 3 ────────────────────────────────────── */

FIGURES["ch03-place-search.svg"] = () => {
  const width = 1040;
  const axisLeft = 170;
  const axisRight = width - 40;
  const seconds = 10;
  const at = (second) => axisLeft + (second / seconds) * (axisRight - axisLeft);

  const laneY = { you: TOP + 40, plain: TOP + 130, model: TOP + 230 };
  const laneLabels = [
    pill(32, laneY.you + 5, "You type", { hue: "orange" }).svg,
    pill(32, laneY.plain + 5, "Plain lane", { hue: "blue" }).svg,
    pill(32, laneY.model + 5, "Model lane", { hue: "purple" }).svg,
  ].join("");

  const ticks = Array.from({ length: seconds + 1 }, (_, second) => {
    const x = at(second);
    return `<path d="M${x} ${TOP + 300} V${TOP + 306}" stroke="${FAINT}"/>` + text(x, TOP + 322, `${second} s`, { size: 11, fill: FAINT, anchor: "middle", mono: true });
  }).join("") + `<path d="M${axisLeft} ${TOP + 300} H${axisRight}" stroke="${FAINT}"/>`;

  const typed = text(at(0), laneY.you + 4, "\"mt rainier henry jackson\"", { size: 13, mono: true, weight: 600 });

  const segment = (from, to, y, hue, label) => {
    const colour = HUE[hue];
    const w = Math.max(at(to) - at(from), 4);
    return `<rect x="${at(from)}" y="${y - 9}" width="${w}" height="18" rx="6" fill="${colour.strong}" fill-opacity=".85"/>`
      + text(at(to) + 8, y + 5, label, { size: 12, fill: colour.ink });
  };

  const plain = segment(0.25, 1.2, laneY.plain, "blue", "Photon finds nothing by that name, so \"Other matches\" stays empty");

  const model = segment(0.7, 1.6, laneY.model - 30, "purple", "guess a name and an area")
    + segment(1.6, 4.2, laneY.model, "purple", "find the area: Mount Rainier NP")
    + segment(4.2, 7.9, laneY.model + 30, "purple", "search inside it: \"jackson\"")
    + segment(7.9, 9.4, laneY.model, "purple", "choose");
  const result = pill(at(9.4), laneY.model - 32, "Best match: Jackson Visitor Center", { hue: "green", anchor: "end" }).svg;

  return figure({ width, height: TOP + 350, title: "Two lanes answer one search", subtitle: "Measured 2026-10-31 with Photon refusing connections, so every lookup used the slower Nominatim fallback." },
    laneLabels + ticks + typed + plain + model + result);
};

FIGURES["ch03-itinerary.svg"] = () => {
  const width = 1000;
  const y = TOP + 70;
  const places = [
    { label: "M", name: "Issaquah park-and-ride", kind: "meeting point", hue: "green" },
    { label: "1", name: "Coffee in Snoqualmie", kind: "stop on the way", hue: "blue" },
    { label: "2", name: "Snoqualmie Falls", kind: "optional stop", hue: "slate" },
    { label: "V", name: "Rattlesnake Ledge trailhead", kind: "event venue", hue: "orange" },
  ];
  const step = (width - 300) / (places.length - 1);
  const xs = places.map((_, index) => 150 + index * step);

  const lines = xs.slice(1).map((x, index) => {
    const dashed = places[index + 1].hue === "slate" || places[index].hue === "slate";
    return `<path d="M${xs[index] + 22} ${y} H${x - 22}" stroke="${FAINT}" stroke-width="2.5" stroke-dasharray="${dashed ? "3 6" : "8 6"}"/>`;
  }).join("");

  const pins = places.map((place, index) => {
    const x = xs[index];
    const colour = HUE[place.hue];
    return `<circle cx="${x}" cy="${y}" r="20" fill="${colour.strong}"/>`
      + text(x, y + 6, place.label, { size: 16, weight: 750, fill: "#ffffff", anchor: "middle" })
      + text(x, y + 50, place.name, { size: 13, weight: 650, anchor: "middle" })
      + text(x, y + 68, place.kind, { size: 12, fill: MUTED, anchor: "middle" });
  }).join("");

  const legend = text(width / 2, y + 120, "Trip directions pass through M, every stop that is not optional, and V. The forecast is taken at V.", { size: 12.5, fill: MUTED, anchor: "middle", italic: true });

  return figure({ width, height: y + 150, title: "An event can go to more than one place", subtitle: "The editor keeps this order: the meeting point first, the stops as planned, the venue last." }, lines + pins + legend);
};

/* ── Chapter 4 ────────────────────────────────────── */

FIGURES["ch04-model-path.svg"] = () => {
  const width = 1040;
  const steps = row(width / 2, TOP + 20, 34, [
    { title: "Facts as lines", lines: ["the plan, places, hours,", "elevation, the drive"], hue: "slate", icon: "fileText", w: 210 },
    { title: "One at a time", lines: ["a semaphore with one", "permit: the GPU never splits"], hue: "purple", icon: "clock", w: 250 },
    { title: "A JSON schema", lines: ["the server can only", "write that shape"], hue: "purple", icon: "code", w: 200 },
    { title: "Checked in Rust", lines: ["enums, dates, lengths,", "quantities; drop the rest"], hue: "green", icon: "check", w: 220 },
  ]);
  const links = steps.slice(1).map((drawn, index) => across(steps[index].box, drawn.box, { hue: "slate" })).join("");

  const exampleY = steps[0].box.y + steps[0].box.h + 40;
  const lines = [
    "13:00: 6 °C (feels 2 °C), mainly clear, precipitation chance 20%",
    "(0.0 mm), wind 8 km/h gusting 15, freezing level 2130 m",
  ];
  const facts = `<rect x="32" y="${exampleY}" width="${width - 64}" height="106" rx="12" fill="#ffffff" stroke="${LINE}"/>`
    + text(52, exampleY + 26, "One line of the facts, as the model reads it and as you can check it:", { size: 12.5, fill: MUTED })
    + lines.map((line, index) => text(52, exampleY + 56 + index * 22, line, { size: 13, mono: true })).join("");

  return figure({ width, height: exampleY + 140, title: "Every model job takes the same path", subtitle: "The schema stops broken JSON. The Rust checks stop well-formed nonsense. Neither proves a claim is true." }, links + svgOf(steps) + facts);
};

FIGURES["ch04-model-jobs.svg"] = () => {
  const width = 1040;
  const jobs = [
    { title: "plan_items", lines: ["the packing list · ~7 s"], icon: "listChecks" },
    { title: "items_for_search", lines: ["\"my feet get cold\""], icon: "search" },
    { title: "write_briefing", lines: ["the conditions · 4.5 s"], icon: "cloudSun" },
    { title: "interpret_place_search", lines: ["read a search · ~1 s"], icon: "pin" },
    { title: "choose_places", lines: ["pick from real places"], icon: "map" },
    { title: "draft_event", lines: ["an event from your words"], icon: "calendar" },
    { title: "draft_tribe", lines: ["a tribe from your words · 1.7 s"], icon: "users" },
    { title: "write_description", lines: ["Write with AI"], icon: "wand" },
    { title: "design_cover", lines: ["a cover scene · 0.8 s"], icon: "image" },
  ];
  const columns = 3;
  const cellWidth = (width - 64 - 2 * 18) / columns;
  const drawn = jobs.map((job, index) => card({ ...job, x: 32 + (index % columns) * (cellWidth + 18), y: TOP + 10 + Math.floor(index / columns) * 82, w: cellWidth, hue: "purple", mono: false }));

  return figure({ width, height: TOP + 10 + 3 * 82 + 20, title: "Nine jobs, one model", subtitle: "Each is a method on Brain with its own prompt and schema. Times measured on the Thor, 2026-10-31." }, svgOf(drawn));
};

/* ── Chapter 5 ────────────────────────────────────── */

FIGURES["ch05-venue.svg"] = () => {
  const width = 1000;
  const left = 110;
  const right = width - 60;
  const base = TOP + 300;
  const highest = 7000;
  const yOf = (feet) => base - (feet / highest) * 270;

  const grid = [0, 2000, 4000, 6000].map((feet) =>
    `<path d="M${left} ${yOf(feet)} H${right}" stroke="${LINE}"/>` + text(left - 12, yOf(feet) + 4, `${feet.toLocaleString("en-US")} ft`, { size: 11.5, fill: FAINT, anchor: "end", mono: true })).join("");

  const ground = [[left, 272], [left + 140, 400], [left + 300, 900], [left + 470, 2100], [left + 620, 3900], [left + 740, 5000], [right, 5433]];
  const groundPath = ground.map(([x, feet], index) => `${index ? "L" : "M"}${x} ${yOf(feet).toFixed(1)}`).join(" ");
  const hill = `<path d="${groundPath} L${right} ${base} L${left} ${base} Z" fill="${HUE.green.soft}"/><path d="${groundPath}" fill="none" stroke="${HUE.green.strong}" stroke-width="2.5"/>`;

  const freezing = yOf(5315);
  const freezeLine = `<path d="M${left} ${freezing} H${right}" stroke="${HUE.blue.strong}" stroke-width="1.8" stroke-dasharray="7 6"/>`
    + text(left + 260, freezing - 10, "freezing level, 5,315 ft (1,620 m)", { size: 12.5, fill: HUE.blue.ink, weight: 600 })
    + icon("snow", left + 234, freezing - 26, 18, HUE.blue.strong);

  const meet = `<circle cx="${left}" cy="${yOf(272)}" r="9" fill="${HUE.slate.strong}"/>`
    + text(left + 6, yOf(272) - 48, "Meeting point: a park-and-ride, 272 ft", { size: 12.5, weight: 600 });
  const venue = `<circle cx="${right}" cy="${yOf(5433)}" r="9" fill="${HUE.orange.strong}"/>`
    + text(right - 14, yOf(5433) - 40, "Venue: Paradise, 5,433 ft", { size: 12.5, weight: 600, anchor: "end" })
    + text(right - 14, yOf(5433) - 22, "the forecast is taken here", { size: 12, fill: MUTED, anchor: "end" });

  return figure({ width, height: base + 40, title: "The weather that matters is at the trail", subtitle: "Same day, two places, 5,161 ft apart. At the venue, the forecast puts the freezing level below the ground." },
    grid + hill + freezeLine + meet + venue);
};

FIGURES["ch05-briefing.svg"] = () => {
  const width = 1060;
  const steps = row(width / 2, TOP + 16, 32, [
    { title: "Open-Meteo", lines: ["16 days, hour by hour", "kept: 1 h before to 9 h after"], hue: "blue", icon: "cloudSun", w: 240 },
    { title: "Trip facts", lines: ["one line per hour,", "plus elevation and daylight"], hue: "slate", icon: "fileText", w: 230 },
    { title: "write_briefing", lines: ["in the reader's units,", "both °F and °C"], hue: "purple", icon: "sparkles", w: 220 },
  ]);
  const links = steps.slice(1).map((drawn, index) => across(steps[index].box, drawn.box, { hue: "slate" })).join("");

  const answerY = steps[0].box.y + steps[0].box.h + 40;
  const answer = `<rect x="32" y="${answerY}" width="${width - 64}" height="150" rx="12" fill="#ffffff" stroke="${LINE}"/>`
    + `<rect x="32" y="${answerY + 10}" width="4" height="130" rx="2" fill="${HUE.green.strong}"/>`
    + pill(56, answerY + 32, "GOOD CONDITIONS", { hue: "green" }).svg
    + text(56, answerY + 66, "Cool, breezy wildflower walk with late snow risk.", { size: 15, weight: 650 })
    + text(56, answerY + 94, "timing · The 1:09 PM start is ideal, as conditions are dry and clear until 4:00 PM.", { size: 12.5, fill: MUTED })
    + text(56, answerY + 118, "wear · Pack layers for 43°F highs and 34°F lows with wind chill making it feel like 35°F or colder, especially near sunset.", { size: 12.5, fill: MUTED });
  const caches = pill(width - 52, answerY + 32, "cached 1 h per event and units", { hue: "slate", anchor: "end" }).svg;

  return figure({ width, height: answerY + 186, title: "From forecast hours to a briefing", subtitle: "One answer for the test hike, as the event page showed it: a verdict, a headline, and tagged points." },
    links + svgOf(steps) + answer + caches);
};

/* ── Chapter 6 ────────────────────────────────────── */

FIGURES["ch06-stores.svg"] = () => {
  const width = 1060;
  const mapLeft = 32;
  const mapTop = TOP + 10;
  const mapWidth = 480;
  const mapHeight = 330;

  const route = [[70, 270], [160, 245], [230, 195], [320, 178], [380, 128], [420, 105]].map(([x, y]) => [mapLeft + x, mapTop + y]);
  const routePath = route.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
  const panel = `<rect x="${mapLeft}" y="${mapTop}" width="${mapWidth}" height="${mapHeight}" rx="14" fill="#ffffff" stroke="${LINE}"/>`;
  const clip = `<clipPath id="map-panel"><rect x="${mapLeft}" y="${mapTop}" width="${mapWidth}" height="${mapHeight}" rx="14"/></clipPath>`;
  const corridor = `${clip}<g clip-path="url(#map-panel)"><path d="${routePath}" fill="none" stroke="${HUE.blue.soft}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/></g>`
    + `<path d="${routePath}" fill="none" stroke="${HUE.blue.strong}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const [startX, startY] = route[0];
  const [endX, endY] = route[route.length - 1];
  const ends = `<circle cx="${startX}" cy="${startY}" r="8" fill="${HUE.slate.strong}"/>` + text(startX - 6, startY + 26, "you start", { size: 12, fill: MUTED })
    + `<circle cx="${endX}" cy="${endY}" r="8" fill="${HUE.green.strong}"/>` + text(endX - 10, endY - 16, "meeting point", { size: 12, fill: MUTED, anchor: "end" });

  const shop = (x, y, letter, hue) => `<circle cx="${mapLeft + x}" cy="${mapTop + y}" r="13" fill="${HUE[hue].strong}"/>` + text(mapLeft + x, mapTop + y + 5, letter, { size: 13, weight: 750, fill: "#ffffff", anchor: "middle" });
  const shops = shop(245, 214, "A", "green") + shop(150, 220, "B", "blue") + shop(352, 175, "C", "slate");
  const band = text(mapLeft + 20, mapTop + 28, "shaded: 1.5 km either side of the route", { size: 12, fill: MUTED });

  const scoreLeft = mapLeft + mapWidth + 28;
  const scoreWidth = width - 32 - scoreLeft;
  const scores = [
    { title: "A · outdoor shop: 14", lines: ["covers 2 items: 2 × 10 = 20", "+4 min detour: −6 → shown first"], hue: "green" },
    { title: "B · supermarket: 8.5", lines: ["covers 1 item: 10", "+1 min detour: −1.5 → shown second"], hue: "blue" },
    { title: "C · pharmacy: dropped", lines: ["covers 3 items: 30", "+18 min is over the 15-minute limit"], hue: "slate" },
  ];
  let top = mapTop;
  const cards = scores.map((entry) => {
    const drawn = card({ ...entry, x: scoreLeft, y: top, w: scoreWidth });
    top += drawn.box.h + 14;
    return drawn;
  });

  return figure({ width, height: mapTop + mapHeight + 34, title: "A shop is worth a stop if it covers enough", subtitle: "Score = 10 per needed item it sells − 1.5 per minute of detour. A worked example with made-up shops." },
    panel + corridor + ends + shops + band + svgOf(cards));
};

/* ── Chapter 7 ────────────────────────────────────── */

FIGURES["ch07-pictures.svg"] = () => {
  const width = 1100;
  const steps = row(width / 2, TOP + 16, 22, [
    { title: "Check, decode", lines: ["JPEG, PNG, WebP, GIF", "≤ 12,000 px a side"], hue: "slate", w: 190 },
    { title: "Turn upright", lines: ["from the EXIF", "orientation"], hue: "slate", w: 190 },
    { title: "Flatten", lines: ["transparency", "onto white"], hue: "slate", w: 190 },
    { title: "Two sizes", lines: ["1,600 px and 560 px", "on the long side"], hue: "green", w: 190 },
    { title: "Write JPEG", lines: ["quality 82, with", "no metadata at all"], hue: "green", w: 190 },
  ]);
  const links = steps.slice(1).map((drawn, index) => across(steps[index].box, drawn.box, { hue: "slate" })).join("");

  const limitsY = steps[0].box.y + steps[0].box.h + 46;
  const limits = [
    pill(32, limitsY, "≤ 15 MB an upload", { hue: "orange" }),
    pill(206, limitsY, "≤ 300 uploads an hour", { hue: "orange" }),
    pill(406, limitsY, "two at a time, off the threads that answer requests", { hue: "purple" }),
  ].map((drawn) => drawn.svg).join("");
  const why = text(32, limitsY + 42, "A phone photo's EXIF often holds the GPS position where it was taken. Writing new files from the pixels keeps none of it.", { size: 13, fill: MUTED, italic: true });

  return figure({ width, height: limitsY + 74, title: "Every picture is decoded and written again", subtitle: "tribe-media::process: the server only ever serves files it wrote itself, in one format." },
    links + svgOf(steps) + limits + why);
};

FIGURES["ch07-ai-cover.svg"] = () => {
  const width = 1060;
  const design = { landscape: "lake", light: "dawn", weather: "clear", season: "autumn", activity: "paddling", crew: 3 };

  const [model] = row(250, TOP + 16, 0, [{ title: "design_cover", lines: ["reads the name, place, date", "and description; 0.8 s"], hue: "purple", icon: "sparkles", w: 300 }]);
  const choices = Object.entries(design).map(([key, value], index) => pill(52 + (index % 2) * 210, model.box.y + model.box.h + 34 + Math.floor(index / 2) * 32, `${key}: ${value}`, { hue: "purple", mono: true, size: 11.5 }).svg).join("");

  const drawY = model.box.y + model.box.h + 150;
  const steps = [
    card({ x: 32, y: drawY, w: 420, title: "The browser draws it", lines: ["cover_art.ts: the app's own people and trees, as SVG"], hue: "green", icon: "image" }),
  ];
  steps.push(card({ x: 32, y: steps[0].box.y + steps[0].box.h + 26, w: 420, title: "Canvas → PNG, 1,600 × 900", lines: ["then the same upload path as any picture"], hue: "green", icon: "upload" }));
  const links = down(model.box, { top: { x: model.box.bottom.x, y: drawY } }, { hue: "purple" }).replace(/<path d="M[^"]*"[^>]*\/>/, (match) => match) + down(steps[0].box, steps[1].box, { hue: "green" });

  const pictureX = 490;
  const pictureW = width - 32 - pictureX;
  const pictureH = Math.round(pictureW * 9 / 16);
  const drawing = coverSvg(design).replace(/<svg [^>]*>/, `<svg x="${pictureX}" y="${TOP + 16}" width="${pictureW}" height="${pictureH}" viewBox="0 0 800 450">`);
  const frame = `<rect x="${pictureX}" y="${TOP + 16}" width="${pictureW}" height="${pictureH}" rx="2" fill="none" stroke="${LINE}"/>`;
  const caption = text(pictureX, TOP + 16 + pictureH + 26, "The scene above, drawn from that answer.", { size: 12.5, fill: MUTED, italic: true });

  const height = Math.max(steps[1].box.y + steps[1].box.h, TOP + 16 + pictureH + 30) + 34;
  return figure({ width, height, title: "A cover in one short answer", subtitle: "The model picks six words; the page draws the picture. No image model, nothing new to host." },
    svgOf([model, ...steps]) + choices + links + drawing + frame + caption);
};

/* ── Chapter 8 ────────────────────────────────────── */

FIGURES["ch08-web-app.svg"] = () => {
  const width = 1040;
  const layers = [
    { title: "index.html", lines: ["theme.ts first, as a classic script, so the page never flashes the wrong theme; then Leaflet and app.ts"], hue: "slate", icon: "fileText" },
    { title: "app.ts · chrome.ts · session.ts", lines: ["the hash router, the header, sidebar and tab bar, and who is signed in"], hue: "green", icon: "logoPeak" },
    { title: "views/", lines: ["one module per page; the event page is one per tab: overview, packing, getting there, photos"], hue: "blue", icon: "calendar" },
    { title: "components/", lines: ["place search, places editor, Markdown editor, assistant, cover maker, conditions, cards"], hue: "orange", icon: "list" },
    { title: "ui/ · dom.ts · format.ts · map.ts · art.ts · cover_art.ts", lines: ["building elements, dates and units, Leaflet, the illustrations"], hue: "gold", icon: "image" },
    { title: "api/client.ts · api/types.ts", lines: ["one typed function per REST route; types that match the Rust JSON"], hue: "purple", icon: "code" },
  ];
  let top = TOP + 10;
  const drawn = layers.map((layer) => {
    const next = card({ ...layer, x: 32, y: top, w: width - 64 });
    top += next.box.h + 22;
    return next;
  });
  const links = drawn.slice(1).map((layer, index) => down(drawn[index].box, layer.box, { hue: "slate" })).join("");
  const rest = pill(width / 2, top + 6, "calls /api on the same server", { hue: "purple", anchor: "middle" }).svg;

  return figure({ width, height: top + 44, title: "The web app, top to bottom", subtitle: "47 TypeScript modules, strict mode. Each layer only imports from the layers below it." }, svgOf(drawn) + links + rest);
};

FIGURES["ch08-build.svg"] = () => {
  const width = 1080;
  const steps = row(width / 2, TOP + 20, 30, [
    { title: "web/src", lines: ["TypeScript"], hue: "blue", icon: "code", w: 160 },
    { title: "tsc", lines: ["strict, no unchecked", "index access"], hue: "blue", icon: "check", w: 190 },
    { title: "web/dist", lines: ["ES modules"], hue: "slate", icon: "fileText", w: 160 },
    { title: "build.rs", lines: ["lists every file", "the page loads"], hue: "green", icon: "list", w: 180 },
    { title: "one binary", lines: ["include_bytes!", "10.4 MB"], hue: "green", icon: "logoPeak", w: 180 },
  ]);
  const links = steps.slice(1).map((drawn, index) => across(steps[index].box, drawn.box, { hue: "slate" })).join("");
  const note = text(width / 2, steps[0].box.y + steps[0].box.h + 40, "cargo build does all of it; the web app can never be a different version from the API.", { size: 12.5, fill: MUTED, anchor: "middle", italic: true });

  return figure({ width, height: steps[0].box.y + steps[0].box.h + 74, title: "From TypeScript to one file", subtitle: "tribe-server's build script compiles the web app, then embeds what the page loads." }, links + svgOf(steps) + note);
};

/* ── Chapter 9 ────────────────────────────────────── */

FIGURES["ch09-session.svg"] = () => {
  const width = 1120;
  const [server] = row(600, TOP + 20, 0, [{ title: "Server", lines: ["password checked with Argon2id", "new token: 256 random bits", "keeps no copy of it"], hue: "green", icon: "logoPeak", w: 290 }]);
  const [browser] = row(175, TOP + 20, 0, [{ title: "Browser", lines: ["olt_session cookie", "HttpOnly · SameSite=Lax", "Secure · 30 days"], hue: "orange", icon: "monitor", w: 260 }]);
  const storeHeight = card({ x: 0, y: 0, w: 250, title: "sessions table", lines: ["SHA-256 of the token", "user_id, expires_at"], icon: "list" }).box.h;
  const store = card({ x: width - 32 - 250, y: server.box.y + (server.box.h - storeHeight) / 2, w: 250, title: "sessions table", lines: ["SHA-256 of the token", "user_id, expires_at"], hue: "gold", icon: "list" });

  const gapMiddle = (browser.box.right.x + server.box.left.x) / 2;
  const signIn = arrow([{ x: browser.box.right.x, y: browser.box.y + 34 }, { x: server.box.left.x, y: server.box.y + 34 }], { hue: "orange" });
  const cookie = arrow([{ x: server.box.left.x, y: server.box.y + 74 }, { x: browser.box.right.x, y: browser.box.y + 74 }], { hue: "green" });
  const hashed = across(server.box, store.box, { hue: "gold" });
  const labels = text(gapMiddle, browser.box.y + 24, "POST /api/sessions", { size: 11.5, fill: MUTED, anchor: "middle", mono: true })
    + text(gapMiddle, browser.box.y + 96, "Set-Cookie", { size: 11.5, fill: MUTED, anchor: "middle", mono: true });

  const noteY = browser.box.y + browser.box.h + 46;
  const note = text(width / 2, noteY, "A stolen copy of the database holds hashes only: none of them signs anyone in.", { size: 13, fill: MUTED, anchor: "middle", italic: true });

  return figure({ width, height: noteY + 34, title: "Signing in", subtitle: "The token lives in the browser; the server keeps only its hash." },
    svgOf([browser, server, store]) + signIn + cookie + hashed + labels + note);
};

/* ── Chapter 10 ───────────────────────────────────── */

FIGURES["ch10-going-live.svg"] = () => {
  const width = 1040;
  const [person] = row(160, TOP + 30, 0, [{ title: "Anyone", lines: ["opens the address", "on any network"], hue: "orange", icon: "users", w: 220 }]);
  const [relays] = row(470, TOP + 30, 0, [{ title: "Tailscale relays", lines: ["end TLS with a certificate", "Tailscale issued"], hue: "blue", icon: "share", w: 270 }]);

  const thorTop = TOP + 170;
  const appNode = card({ x: 300, y: thorTop + 50, w: 330, title: "node \"ourlittletribe\"", lines: ["userspace tailscaled, no root", "Funnel :443 → 127.0.0.1:8090"], hue: "green", icon: "logoPeak" });
  const appHeight = card({ x: 0, y: 0, w: 250, title: "ourlittletribe", lines: ["the app, 127.0.0.1:8090"] }).box.h;
  const app = card({ x: width - 32 - 30 - 250, y: appNode.box.y + (appNode.box.h - appHeight) / 2, w: 250, title: "ourlittletribe", lines: ["the app, 127.0.0.1:8090"], hue: "green", icon: "mountain" });
  const systemNode = card({ x: 300, y: thorTop + 150, w: 330, title: "node \"arpanpathak\"", lines: ["the Thor's own: SSH, the Cub"], hue: "slate", icon: "monitor" });
  const thor = region({ x: 270, y: thorTop, w: width - 32 - 270, h: 240, label: "Jetson AGX Thor", hue: "green" });

  const links = across(person.box, relays.box, { hue: "orange" })
    + arrow([relays.box.bottom, { x: relays.box.bottom.x, y: appNode.box.top.y }], { hue: "blue", label: "over the tailnet", labelAt: { x: relays.box.bottom.x + 80, y: relays.box.bottom.y + 34 } })
    + across(appNode.box, app.box, { hue: "green" });
  const address = pill(width - 32, TOP + 20, "https://ourlittletribe.taildb9a39.ts.net", { hue: "green", anchor: "end", mono: true });

  return figure({ width, height: thorTop + 274, title: "A public address with no open port", subtitle: "The app has its own Tailscale node, so its name and Funnel never touch the Thor's." },
    thor + svgOf([person, relays, appNode, app, systemNode]) + links + address.svg);
};

/* ── Writing them out ─────────────────────────────── */

mkdirSync(out, { recursive: true });
for (const old of readdirSync(out)) rmSync(join(out, old));
for (const [name, draw] of Object.entries(FIGURES)) writeFileSync(join(out, name), draw());
console.log(`wrote ${Object.keys(FIGURES).length} figures to ${out}`);

export { edges, icon };
