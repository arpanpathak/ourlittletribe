// Writes every figure in the book from the drawing kit, so they share one
// look and every arrow meets the boxes it joins. Check the result with
// tools/audit.mjs.
// Usage: node book/tools/figures.mjs

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FAINT, HUE, INK, LINE, MUTED, TOP, across, arrow, card, down, edges, figure, icon, pill, region, text } from "./kit.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { coverSvg } = await import(join(repo, "web", "dist", "cover_art.js"));

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "figures");

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

  const [browser] = row(middle, TOP + 10, 0, [{ title: "Your browser", lines: ["The web app: 51 TypeScript modules", "Map tiles straight from OpenStreetMap"], hue: "orange", icon: "monitor" }]);

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

  const [server] = row(middle, TOP + 10, 0, [{ title: "tribe-server", lines: ["routes, sessions, caches, search, trips, trails · 4,889 lines"], hue: "green", icon: "logoPeak" }]);
  const middleRow = row(middle, TOP + 150, 18, [
    { title: "tribe-db", lines: ["schema, queries, search", "3,564 lines"], hue: "gold", icon: "list", w: 226 },
    { title: "tribe-places", lines: ["map services, trails, shops", "2,347 lines"], hue: "blue", icon: "map", w: 226 },
    { title: "tribe-brain", lines: ["prompts, schemas, checks", "1,884 lines"], hue: "purple", icon: "sparkles", w: 236 },
    { title: "tribe-media", lines: ["decode, resize, clean SVG", "613 lines"], hue: "slate", icon: "image", w: 226 },
  ]);
  const [core] = row(middle - 115, TOP + 300, 0, [{ title: "tribe-core", lines: ["geometry, ranking, baskets, trails · no I/O · 1,020 lines"], hue: "green", icon: "gauge" }]);

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
  const width = 1080;
  const y = TOP + 150;
  const places = [
    { label: "M", name: "Green Lake Park & Ride", kind: "meeting point", hue: "green" },
    { label: "1", name: "Coffee in Issaquah", kind: "stop on the way", hue: "blue" },
    { label: "2", name: "Snoqualmie Falls", kind: "optional stop", hue: "slate" },
    { label: "V", name: "Rattlesnake Lake Trailhead", kind: "event venue", hue: "orange" },
    { label: "A", name: "Lunch in North Bend", kind: "after the event", hue: "gold" },
  ];
  const step = (width - 300) / (places.length - 1);
  const xs = places.map((_, index) => 150 + index * step);

  const lines = xs.slice(1).map((x, index) => {
    const optional = places[index + 1].hue === "slate" || places[index].hue === "slate";
    return `<path d="M${xs[index] + 22} ${y} H${x - 22}" stroke="${FAINT}" stroke-width="2.5" stroke-dasharray="${optional ? "3 6" : "8 6"}"/>`;
  }).join("");

  const pin = (x, pinY, label, hue) => `<circle cx="${x}" cy="${pinY}" r="20" fill="${HUE[hue].strong}"/>` + text(x, pinY + 6, label, { size: 16, weight: 750, fill: "#ffffff", anchor: "middle" });
  const pins = places.map((place, index) => pin(xs[index], y, place.label, place.hue)
    + text(xs[index], y + 50, place.name, { size: 13, weight: 650, anchor: "middle" })
    + text(xs[index], y + 68, place.kind, { size: 12, fill: MUTED, anchor: "middle" })).join("");

  const pickups = ["Bellevue", "Kent", "Tacoma"].map((town, index) => {
    const x = xs[0] - 90 + index * 90;
    return pin(x, y - 100, "P", "purple") + text(x, y - 60, town, { size: 12, weight: 600, anchor: "middle" })
      + `<path d="M${x} ${y - 52} L${xs[0]} ${y - 22}" stroke="${HUE.purple.strong}" stroke-opacity=".45" stroke-width="2" stroke-dasharray="2 5"/>`;
  }).join("");
  const pickupNote = text(xs[0] + 150, y - 96, "also meeting at: other places to join from", { size: 12.5, fill: HUE.purple.ink, weight: 600 });

  const legend = text(width / 2, y + 120, "Directions pass through M, the stops everyone makes, V and A. Pickups are alternatives, so the line skips them.", { size: 12.5, fill: MUTED, anchor: "middle", italic: true });

  return figure({ width, height: y + 150, title: "An event can go to many places", subtitle: "The meeting point first, then other meeting points, stops on the way, the venue, and where the group goes after." }, lines + pickups + pickupNote + pins + legend);
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
    { title: "describe_cover", lines: ["a cover scene in words · ~3 s"], icon: "fileText" },
    { title: "draw_cover", lines: ["the scene as SVG · ~60 s"], icon: "image" },
    { title: "related_words", lines: ["widen a search · 0.9 s"], icon: "sparkles" },
  ];
  const columns = 2;
  const cellWidth = (width - 64 - 2 * 18) / columns;
  const drawn = jobs.map((job, index) => card({ ...job, x: 32 + (index % columns) * (cellWidth + 18), y: TOP + 10 + Math.floor(index / columns) * 82, w: cellWidth, hue: "purple", mono: false }));

  return figure({ width, height: TOP + 10 + 6 * 82 + 20, title: "Eleven jobs, one model", subtitle: "Each is a method on Brain with its own prompt and schema. Times measured on the Thor, 2026-10-31." }, svgOf(drawn));
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

FIGURES["ch05-trail.svg"] = () => {
  const trail = JSON.parse(readFileSync(join(here, "data", "skyline-trail.json"), "utf8"));
  const width = 1060;
  const top = TOP + 10;
  const height = 300;

  const shapeLeft = 32;
  const shapeWidth = 300;
  const lats = trail.line.map(([lat]) => lat);
  const lngs = trail.line.map(([, lng]) => lng);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);
  const squash = Math.cos((north * Math.PI) / 180);
  const scale = Math.min((shapeWidth - 60) / ((east - west) * squash), (height - 60) / (north - south));
  const shapeX = (lng) => shapeLeft + 30 + (lng - west) * squash * scale;
  const shapeY = (lat) => top + 30 + (north - lat) * scale;

  const path = trail.line.map(([lat, lng], index) => `${index ? "L" : "M"}${shapeX(lng).toFixed(1)} ${shapeY(lat).toFixed(1)}`).join(" ");
  const [startLat, startLng] = trail.line[0];
  const shape = `<rect x="${shapeLeft}" y="${top}" width="${shapeWidth}" height="${height}" rx="14" fill="#ffffff" stroke="${LINE}"/>`
    + `<path d="${path}" fill="none" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>`
    + `<path d="${path}" fill="none" stroke="${HUE.orange.strong}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${shapeX(startLng)}" cy="${shapeY(startLat)}" r="7" fill="${HUE.green.strong}"/>`
    + text(shapeX(startLng) + 12, shapeY(startLat) + 20, "start and finish", { size: 11.5, fill: MUTED });

  const chartLeft = shapeLeft + shapeWidth + 70;
  const chartRight = width - 40;
  const chartTop = top + 20;
  const chartBottom = top + height - 50;
  const { lowest_m: lowest, highest_m: highest } = trail.climb;
  const pad = 40;
  const yOf = (metres) => chartBottom - ((metres - (lowest - pad)) / (highest - lowest + 2 * pad)) * (chartBottom - chartTop);
  const xOf = (index) => chartLeft + (index / (trail.profile.length - 1)) * (chartRight - chartLeft);

  const profileLine = trail.profile.map((metres, index) => `${xOf(index).toFixed(1)},${yOf(metres).toFixed(1)}`).join(" ");
  const area = `${chartLeft},${chartBottom} ${profileLine} ${chartRight},${chartBottom}`;
  const gridHeights = [1700, 1800, 1900, 2000, 2100];
  const grid = gridHeights.map((metres) => `<path d="M${chartLeft} ${yOf(metres)} H${chartRight}" stroke="${LINE}"/>` + text(chartLeft - 10, yOf(metres) + 4, `${metres.toLocaleString("en-US")} m`, { size: 11, fill: FAINT, anchor: "end", mono: true })).join("");
  const axis = text(chartLeft, chartBottom + 22, "0 km", { size: 11, fill: FAINT, mono: true }) + text(chartRight, chartBottom + 22, `${trail.length_km.toFixed(1)} km`, { size: 11, fill: FAINT, mono: true, anchor: "end" });

  const peakIndex = trail.profile.indexOf(Math.max(...trail.profile));
  const peak = `<circle cx="${xOf(peakIndex)}" cy="${yOf(highest)}" r="5" fill="${HUE.orange.strong}"/>` + text(xOf(peakIndex) + 10, yOf(highest) - 8, `high point ${highest.toLocaleString("en-US")} m`, { size: 12, weight: 600 });
  const chart = grid + `<polygon points="${area}" fill="${HUE.orange.soft}"/><polyline points="${profileLine}" fill="none" stroke="${HUE.orange.strong}" stroke-width="2.5"/>` + axis + peak;

  const facts = [
    pill(chartLeft, top + height + 6, `${trail.length_km.toFixed(1)} km`, { hue: "slate", mono: true }),
    pill(chartLeft + 100, top + height + 6, `↑ about ${trail.climb.gain_m} m`, { hue: "orange", mono: true }),
    pill(chartLeft + 254, top + height + 6, `grade: ${trail.difficulty}`, { hue: "gold", mono: true }),
  ].map((drawn) => drawn.svg).join("");

  return figure({ width, height: top + height + 44, title: "The Skyline Trail, measured", subtitle: `Its line from Waymarked Trails, 60 heights from Open-Meteo along it. Measured ${trail.measured}.` }, shape + chart + facts);
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
  const width = 1080;
  const drawingSource = readFileSync(join(here, "data", "model-cover.svg"), "utf8");

  let top = TOP + 10;
  const steps = [
    { title: "describe_cover", lines: ["writes the scene from the name, place,", "date and description · about 3 s"], hue: "purple", icon: "fileText" },
    { title: "You edit it", lines: ["change the light, the season,", "who is there, the style"], hue: "orange", icon: "edit" },
    { title: "draw_cover", lines: ["writes one SVG, shape by shape", "about 4,000 tokens · about 60 s"], hue: "purple", icon: "sparkles" },
    { title: "clean_svg", lines: ["keeps plain drawing elements only;", "no scripts, links or text"], hue: "green", icon: "check" },
    { title: "PNG, then upload", lines: ["a canvas makes 1,600 × 900; the", "picture pipeline re-encodes it"], hue: "green", icon: "upload" },
  ].map((step) => {
    const drawn = card({ ...step, x: 32, y: top, w: 360 });
    top += drawn.box.h + 22;
    return drawn;
  });
  const links = steps.slice(1).map((drawn, index) => down(steps[index].box, drawn.box, { hue: "slate" })).join("");

  const pictureX = 430;
  const pictureW = width - 32 - pictureX;
  const pictureH = Math.round((pictureW * 9) / 16);
  const drawing = drawingSource.replace(/<svg [^>]*>/, `<svg x="${pictureX}" y="${TOP + 10}" width="${pictureW}" height="${pictureH}" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">`);
  const frame = `<rect x="${pictureX}" y="${TOP + 10}" width="${pictureW}" height="${pictureH}" rx="2" fill="none" stroke="${LINE}"/>`;
  const caption = [
    "The model's own drawing for \"Rattlesnake Ledge slow hike and lunch\",",
    "from its scene: an early November morning, Rattlesnake Lake below,",
    "snow-dusted Cascade peaks in haze, four hikers in rust, olive and charcoal.",
  ].map((line, index) => text(pictureX, TOP + 10 + pictureH + 28 + index * 19, line, { size: 12.5, fill: MUTED, italic: index === 0 })).join("");

  const height = Math.max(top, TOP + 10 + pictureH + 90) + 20;
  return figure({ width, height, title: "The model draws the cover", subtitle: "Two answers from the model that already runs the app: a scene in words, then the scene in SVG." },
    links + svgOf(steps) + drawing + frame + caption);
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

  return figure({ width, height: top + 44, title: "The web app, top to bottom", subtitle: "51 TypeScript modules, strict mode. Each layer only imports from the layers below it." }, svgOf(drawn) + links + rest);
};

FIGURES["ch08-build.svg"] = () => {
  const width = 1080;
  const steps = row(width / 2, TOP + 20, 30, [
    { title: "web/src", lines: ["TypeScript"], hue: "blue", icon: "code", w: 160 },
    { title: "tsc", lines: ["strict, no unchecked", "index access"], hue: "blue", icon: "check", w: 190 },
    { title: "web/dist", lines: ["ES modules"], hue: "slate", icon: "fileText", w: 160 },
    { title: "build.rs", lines: ["lists every file", "the page loads"], hue: "green", icon: "list", w: 180 },
    { title: "one binary", lines: ["include_bytes!", "10.8 MB"], hue: "green", icon: "logoPeak", w: 180 },
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
