// Writes the book's system diagrams as SVG, from short descriptions of boxes
// and arrows, so every figure shares one look.
// Usage: node book/tools/figures.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "figures");

/** Box styles: our own code, a service we call, storage, the person, and planned work. */
const STYLES = {
  app: { fill: "#e5f2eb", stroke: "#1f6f4e", text: "#10362a" },
  service: { fill: "#e8f0fa", stroke: "#2563a8", text: "#17375e" },
  store: { fill: "#f6efe3", stroke: "#a8741a", text: "#5a3d0a" },
  person: { fill: "#fdeee6", stroke: "#c2410c", text: "#6b2306" },
  model: { fill: "#efe9f8", stroke: "#6b4fa0", text: "#36255a" },
  planned: { fill: "#fffaf0", stroke: "#d99a1e", text: "#7a5600", dash: "6 5" },
  plain: { fill: "#ffffff", stroke: "#9aa39e", text: "#2b302d" },
};

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A rounded box with a title and up to three smaller lines under it. */
function box(node) {
  const style = STYLES[node.kind || "app"];
  const lines = node.sub ? [].concat(node.sub) : [];
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  const titleY = node.y + node.h / 2 - lines.length * 8 + 5;

  let text = `<text x="${node.x + node.w / 2}" y="${titleY}" text-anchor="middle" font-size="14" font-weight="700" fill="${style.text}">${escapeXml(node.label)}</text>`;
  lines.forEach((line, index) => {
    text += `<text x="${node.x + node.w / 2}" y="${titleY + 18 + index * 16}" text-anchor="middle" font-size="12" fill="${style.text}" opacity=".85">${escapeXml(line)}</text>`;
  });

  return `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="10" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1.6"${dash}/>${text}`;
}

/** Where the line from a box's centre toward (tx, ty) leaves the box. */
function edgePoint(node, tx, ty) {
  const cx = node.x + node.w / 2;
  const cy = node.y + node.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];

  const scaleX = dx === 0 ? Infinity : (node.w / 2 + 3) / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : (node.h / 2 + 3) / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return [cx + dx * scale, cy + dy * scale];
}

/** An arrow between two boxes, with an optional label at its middle. */
function arrow(from, to, { label = "", dashed = false, both = false } = {}) {
  const fromCenter = [from.x + from.w / 2, from.y + from.h / 2];
  const toCenter = [to.x + to.w / 2, to.y + to.h / 2];
  const [x1, y1] = edgePoint(from, ...toCenter);
  const [x2, y2] = edgePoint(to, ...fromCenter);
  const dash = dashed ? ' stroke-dasharray="5 4"' : "";
  const start = both ? ' marker-start="url(#tail)"' : "";

  let svg = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#5b625e" stroke-width="1.5"${dash} marker-end="url(#head)"${start}/>`;
  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const width = label.length * 6.4 + 12;
    svg += `<rect x="${mx - width / 2}" y="${my - 10}" width="${width}" height="18" rx="9" fill="#ffffff" stroke="#d2d2cc"/>`;
    svg += `<text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="11" fill="#3a403c">${escapeXml(label)}</text>`;
  }
  return svg;
}

/** A labelled background region grouping boxes, such as "the Thor". */
function region(area) {
  return `<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" rx="14" fill="${area.fill || "#f7f7f5"}" stroke="#c9cec9" stroke-dasharray="4 4"/>`
    + `<text x="${area.x + 14}" y="${area.y + 22}" font-size="12.5" font-weight="700" fill="#5b625e" letter-spacing=".04em">${escapeXml(area.label.toUpperCase())}</text>`;
}

/** Writes one figure: `regions`, `nodes` by id, and `edges` as [from, to, options]. */
function figure(file, { width, height, title, regions = [], nodes, edges = [], notes = [] }) {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const defs = `<defs>
<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5b625e"/></marker>
<marker id="tail" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="#5b625e"/></marker>
</defs>`;

  let body = `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  body += regions.map(region).join("");
  body += edges.map(([from, to, options]) => arrow(byId[from], byId[to], options)).join("");
  body += nodes.map(box).join("");
  body += notes.map((note) => `<text x="${note.x}" y="${note.y}" font-size="12" fill="#5b625e" ${note.anchor ? `text-anchor="${note.anchor}"` : ""}>${escapeXml(note.text)}</text>`).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(title)}" font-family="${FONT}">${defs}${body}</svg>`;
  writeFileSync(join(out, file), svg);
}

/* ── Figure 1.1: the whole system ─────────────────── */

figure("system-overview.svg", {
  width: 960,
  height: 560,
  title: "Browsers reach the app through Tailscale Funnel. On the Thor, one Rust binary serves the web app and API, keeps everything in one SQLite file and a pictures folder, and asks the local model and public map services.",
  regions: [
    { x: 150, y: 20, w: 560, h: 520, label: "Jetson AGX Thor" },
    { x: 730, y: 20, w: 215, h: 520, label: "Public services" },
  ],
  nodes: [
    { id: "browser", x: 15, y: 230, w: 120, h: 70, label: "Browser", sub: ["web app", "phone or laptop"], kind: "person" },
    { id: "funnel", x: 175, y: 60, w: 170, h: 64, label: "Tailscale Funnel", sub: "ourlittletribe.….ts.net", kind: "service" },
    { id: "model", x: 470, y: 55, w: 220, h: 90, label: "TensorRT Edge-LLM", sub: ["Qwen3.6 35B-A3B", "127.0.0.1:8081"], kind: "model" },
    { id: "server", x: 175, y: 205, w: 230, h: 120, label: "tribe-server", sub: ["axum: API, web files,", "pictures, sessions", "one 10 MB binary"] },
    { id: "db", x: 175, y: 410, w: 150, h: 64, label: "SQLite file", sub: "tribe-db", kind: "store" },
    { id: "media", x: 360, y: 410, w: 150, h: 64, label: "Pictures folder", sub: "tribe-media", kind: "store" },
    { id: "photon", x: 750, y: 180, w: 180, h: 54, label: "Photon / Nominatim", sub: "place search", kind: "service" },
    { id: "meteo", x: 750, y: 260, w: 180, h: 54, label: "Open-Meteo", sub: "forecast, elevation", kind: "service" },
    { id: "osrm", x: 750, y: 340, w: 180, h: 54, label: "OSRM", sub: "driving routes", kind: "service" },
    { id: "overpass", x: 750, y: 420, w: 180, h: 54, label: "Overpass", sub: "stores on the route", kind: "service" },
  ],
  edges: [
    ["browser", "funnel", { label: "HTTPS" }],
    ["funnel", "server", { label: "127.0.0.1:8090" }],
    ["server", "model", { label: "tribe-brain" }],
    ["server", "db"],
    ["server", "media"],
    ["server", "photon", { label: "tribe-places" }],
    ["server", "meteo"],
    ["server", "osrm"],
    ["server", "overpass"],
  ],
  notes: [{ x: 15, y: 330, text: "Map tiles load straight" }, { x: 15, y: 346, text: "from OpenStreetMap." }],
});

/* ── Figure 1.2: crates ───────────────────────────── */

figure("crates.svg", {
  width: 860,
  height: 330,
  title: "The six crates. tribe-server depends on all the others; tribe-db, tribe-places and tribe-brain use tribe-core's shared types; tribe-media stands alone.",
  nodes: [
    { id: "server", x: 320, y: 20, w: 220, h: 70, label: "tribe-server", sub: ["routes, sessions, caches,", "search and trip planning"] },
    { id: "db", x: 20, y: 150, w: 180, h: 70, label: "tribe-db", sub: ["tables and queries", "rusqlite"] },
    { id: "places", x: 230, y: 150, w: 180, h: 70, label: "tribe-places", sub: ["Photon, Nominatim, OSRM,", "Overpass, Open-Meteo"] },
    { id: "brain", x: 440, y: 150, w: 180, h: 70, label: "tribe-brain", sub: ["prompts, schemas,", "checking answers"], kind: "model" },
    { id: "media", x: 650, y: 150, w: 190, h: 70, label: "tribe-media", sub: ["decode, resize,", "re-encode pictures"] },
    { id: "core", x: 230, y: 260, w: 390, h: 54, label: "tribe-core", sub: "geometry, clock, basket statistics, store ranking: no I/O" },
  ],
  edges: [
    ["server", "db"],
    ["server", "places"],
    ["server", "brain"],
    ["server", "media"],
    ["db", "core"],
    ["places", "core"],
    ["brain", "core"],
  ],
});

/* ── Figure 2.1: tables ───────────────────────────── */

figure("tables.svg", {
  width: 960,
  height: 470,
  title: "The tables and how they refer to each other: people belong to tribes, tribes hold events, events have stops, RSVPs, list items with marks, pictures and starting points.",
  nodes: [
    { id: "users", x: 20, y: 30, w: 190, h: 80, label: "users", sub: ["name, email, password hash", "avatar_image, cover_image"], kind: "store" },
    { id: "sessions", x: 20, y: 160, w: 190, h: 60, label: "sessions", sub: "token hash, expiry", kind: "store" },
    { id: "members", x: 270, y: 30, w: 190, h: 60, label: "tribe_members", sub: "role: organizer, member", kind: "store" },
    { id: "tribes", x: 520, y: 30, w: 190, h: 60, label: "tribes", sub: "name, area, description", kind: "store" },
    { id: "events", x: 520, y: 170, w: 190, h: 80, label: "events", sub: ["title, description, time", "meeting point lat/lng"], kind: "store" },
    { id: "stops", x: 760, y: 30, w: 180, h: 70, label: "event_stops", sub: ["stop, optional, venue", "position, note"], kind: "store" },
    { id: "rsvps", x: 760, y: 130, w: 180, h: 50, label: "event_rsvps, event_votes", kind: "store" },
    { id: "items", x: 760, y: 215, w: 180, h: 64, label: "prep_items", sub: "model or person, shop tags", kind: "store" },
    { id: "marks", x: 760, y: 320, w: 180, h: 54, label: "item_marks", sub: "bringing, got", kind: "store" },
    { id: "images", x: 520, y: 320, w: 190, h: 64, label: "images", sub: "covers and event photos", kind: "store" },
    { id: "origins", x: 270, y: 200, w: 190, h: 60, label: "trip_origins", sub: "deleted a day after", kind: "store" },
    { id: "stores", x: 270, y: 320, w: 190, h: 64, label: "stores", sub: "cache of OSM shops", kind: "store" },
    { id: "activity", x: 20, y: 270, w: 190, h: 54, label: "activity_log", sub: "the feed", kind: "store" },
    { id: "inline", x: 20, y: 380, w: 190, h: 54, label: "inline_images", sub: "pictures in descriptions", kind: "store" },
  ],
  edges: [
    ["sessions", "users"],
    ["members", "users"],
    ["members", "tribes"],
    ["events", "tribes"],
    ["stops", "events"],
    ["rsvps", "events"],
    ["items", "events"],
    ["marks", "items"],
    ["images", "events"],
    ["origins", "events"],
  ],
  notes: [{ x: 270, y: 450, text: "stores has no links: it is a cache any route can reuse." }],
});

/* ── Figure 3.1: place search ─────────────────────── */

figure("place-search.svg", {
  width: 960,
  height: 470,
  title: "Place search in two lanes. The plain lane sends the text to Photon, or Nominatim when Photon fails, and answers at once. The smart lane asks the model what the words mean, looks each guess up inside its area's bounds, and lets the model choose among the real places found.",
  regions: [
    { x: 160, y: 20, w: 780, h: 120, label: "Plain lane: about a second" },
    { x: 160, y: 160, w: 780, h: 290, label: "Smart lane: two to ten seconds" },
  ],
  nodes: [
    { id: "typed", x: 15, y: 185, w: 130, h: 80, label: "Typed text", sub: ["mt rainier", "henry jackson"], kind: "person" },
    { id: "photon", x: 190, y: 60, w: 210, h: 60, label: "Photon", sub: "Nominatim if Photon fails", kind: "service" },
    { id: "plainout", x: 700, y: 60, w: 210, h: 60, label: "Other matches", sub: "shown at once" },
    { id: "guess", x: 190, y: 210, w: 210, h: 80, label: "Model: what is meant?", sub: ["Henry Jackson Trail,", "Mount Rainier National Park"], kind: "model" },
    { id: "area", x: 440, y: 200, w: 210, h: 54, label: "Find the area", sub: "its bounds, or 0.2° around it", kind: "service" },
    { id: "within", x: 440, y: 290, w: 210, h: 70, label: "Search inside the bounds", sub: ["full name, then each word", "jackson → Jackson Visitor Center"], kind: "service" },
    { id: "choose", x: 700, y: 230, w: 210, h: 80, label: "Model: which of these?", sub: ["real places only,", "near you unless named"], kind: "model" },
    { id: "best", x: 700, y: 370, w: 210, h: 60, label: "Best matches", sub: "put on top of the list" },
  ],
  edges: [
    ["typed", "photon"],
    ["photon", "plainout"],
    ["typed", "guess"],
    ["guess", "area"],
    ["area", "within"],
    ["within", "choose"],
    ["photon", "choose", { dashed: true, label: "plain results join in" }],
    ["choose", "best"],
  ],
});

/* ── Figure 4.1: the model's jobs ─────────────────── */

figure("model-jobs.svg", {
  width: 960,
  height: 420,
  title: "Every job the model does follows one path: facts written as plain lines, one request with a JSON schema, then the answer is checked and trimmed in Rust before anything is saved or shown.",
  nodes: [
    { id: "facts", x: 20, y: 160, w: 190, h: 100, label: "Facts as lines", sub: ["plan, places, forecast,", "elevation, drive,", "what groups bought"] },
    { id: "one", x: 260, y: 160, w: 200, h: 100, label: "One request at a time", sub: ["semaphore of one", "thinking off", "JSON schema, strict"], kind: "model" },
    { id: "check", x: 510, y: 160, w: 190, h: 100, label: "Check in Rust", sub: ["enums, lengths, dates,", "tags, limits", "drop what fails"] },
    { id: "plan", x: 760, y: 20, w: 180, h: 54, label: "Packing list", sub: "plan_items" },
    { id: "brief", x: 760, y: 95, w: 180, h: 54, label: "Conditions briefing", sub: "write_briefing" },
    { id: "draft", x: 760, y: 170, w: 180, h: 54, label: "Form from words", sub: "draft_event" },
    { id: "write", x: 760, y: 245, w: 180, h: 54, label: "Description writer", sub: "write_description" },
    { id: "places", x: 760, y: 320, w: 180, h: 70, label: "Place search", sub: ["interpret_place_search", "choose_places"] },
  ],
  edges: [
    ["facts", "one"],
    ["one", "check"],
    ["check", "plan"],
    ["check", "brief"],
    ["check", "draft"],
    ["check", "write"],
    ["check", "places"],
  ],
});

/* ── Figure 5.1: the briefing ─────────────────────── */

figure("briefing.svg", {
  width: 960,
  height: 300,
  title: "How the Conditions card is built: the venue is found, its hourly forecast and elevation fetched and cached for 30 minutes, the facts written out, and the model's briefing checked and cached for an hour per event and unit system.",
  nodes: [
    { id: "event", x: 20, y: 110, w: 150, h: 70, label: "Event", sub: ["venue, else the", "meeting point"] },
    { id: "meteo", x: 210, y: 40, w: 190, h: 70, label: "Open-Meteo", sub: ["hourly: temperature, rain,", "wind, freezing level"], kind: "service" },
    { id: "elev", x: 210, y: 180, w: 190, h: 60, label: "Elevation", sub: "at the venue", kind: "service" },
    { id: "facts", x: 450, y: 110, w: 170, h: 70, label: "Trip facts", sub: ["itinerary, start,", "hour by hour"] },
    { id: "model", x: 660, y: 40, w: 130, h: 70, label: "Model", sub: "verdict, points", kind: "model" },
    { id: "card", x: 810, y: 110, w: 135, h: 70, label: "The card", sub: ["briefing, hours,", "°F and °C"], kind: "person" },
  ],
  edges: [
    ["event", "meteo"],
    ["event", "elev"],
    ["meteo", "facts"],
    ["elev", "facts"],
    ["facts", "model"],
    ["model", "card", { label: "cached 1 h" }],
    ["facts", "card", { label: "hours, daylight" }],
  ],
});

/* ── Figure 6.1: stores on the way ────────────────── */

figure("stores.svg", {
  width: 960,
  height: 300,
  title: "Stores on the way: the person's starting point and the meeting point give an OSRM route; Overpass finds shops of the needed kinds within 1.5 km of it, falling back to shops seen before; each is ranked by the detour it adds and the items it covers.",
  nodes: [
    { id: "origin", x: 20, y: 40, w: 160, h: 60, label: "Your start", sub: "shared by choice", kind: "person" },
    { id: "needed", x: 20, y: 180, w: 160, h: 70, label: "Still needed", sub: ["your items and", "shared ones nobody has"] },
    { id: "osrm", x: 230, y: 40, w: 170, h: 60, label: "OSRM route", sub: "to the meeting point", kind: "service" },
    { id: "overpass", x: 450, y: 40, w: 190, h: 70, label: "Overpass", sub: ["shops within 1.5 km", "of the route"], kind: "service" },
    { id: "cache", x: 450, y: 180, w: 190, h: 70, label: "stores table", sub: ["shops seen before,", "when Overpass is busy"], kind: "store" },
    { id: "rank", x: 690, y: 110, w: 250, h: 80, label: "Rank", sub: ["detour minutes (OSRM),", "items covered, at most", "three per kind of shop"] },
  ],
  edges: [
    ["origin", "osrm"],
    ["osrm", "overpass"],
    ["overpass", "rank"],
    ["cache", "rank", { dashed: true }],
    ["needed", "rank", { label: "shop tags" }],
  ],
});

/* ── Figure 7.1: pictures ─────────────────────────── */

figure("pictures.svg", {
  width: 960,
  height: 250,
  title: "A picture's path: the upload is checked and limited, decoded off the async threads two at a time, turned upright, resized to 1600 and 560 pixels, re-encoded as JPEG without metadata, written to disk, and recorded in the database.",
  nodes: [
    { id: "upload", x: 20, y: 90, w: 140, h: 70, label: "Upload", sub: ["15 MB at most,", "300 an hour"], kind: "person" },
    { id: "decode", x: 200, y: 90, w: 160, h: 70, label: "Decode", sub: ["JPEG, PNG, WebP, GIF", "12,000 px at most"] },
    { id: "orient", x: 400, y: 90, w: 150, h: 70, label: "Turn upright", sub: ["then forget", "EXIF and GPS"] },
    { id: "resize", x: 590, y: 90, w: 150, h: 70, label: "Two sizes", sub: ["1600 px, 560 px", "JPEG quality 82"] },
    { id: "disk", x: 780, y: 30, w: 160, h: 60, label: "{id}.jpg, {id}_s.jpg", sub: "pictures folder", kind: "store" },
    { id: "row", x: 780, y: 160, w: 160, h: 60, label: "images row", sub: "what it belongs to", kind: "store" },
  ],
  edges: [
    ["upload", "decode"],
    ["decode", "orient"],
    ["orient", "resize"],
    ["resize", "disk"],
    ["resize", "row"],
  ],
});

/* ── Figure 8.1: the web app ──────────────────────── */

figure("web-app.svg", {
  width: 960,
  height: 330,
  title: "The web app: no framework and no build step. theme.js runs before the page draws, app.js routes on the URL hash, views draw pages from small DOM helpers, components are reused across views, and everything is embedded in the server binary.",
  nodes: [
    { id: "theme", x: 20, y: 30, w: 170, h: 60, label: "theme.js", sub: "light, dark, auto" },
    { id: "app", x: 230, y: 30, w: 200, h: 60, label: "app.js", sub: "sidebar, routes, session" },
    { id: "views", x: 230, y: 140, w: 200, h: 70, label: "views/", sub: ["feed, events, event,", "form, tribe, profile"] },
    { id: "components", x: 480, y: 140, w: 220, h: 70, label: "components/", sub: ["place search, locations,", "editor, conditions, voice"] },
    { id: "ui", x: 480, y: 30, w: 220, h: 60, label: "ui.js, icons.js, art.js", sub: "DOM helpers, icons, scenes" },
    { id: "md", x: 740, y: 140, w: 200, h: 70, label: "markdown.js", sub: ["renders to DOM nodes,", "never innerHTML"] },
    { id: "api", x: 230, y: 250, w: 200, h: 54, label: "api.js", sub: "fetch with cookies", kind: "service" },
    { id: "binary", x: 740, y: 250, w: 200, h: 54, label: "Embedded in the binary", sub: "include_bytes!", kind: "store" },
  ],
  edges: [
    ["app", "views"],
    ["views", "components"],
    ["views", "ui"],
    ["components", "md"],
    ["views", "api"],
  ],
});

/* ── Figure 10.1: going live ──────────────────────── */

figure("going-live.svg", {
  width: 960,
  height: 360,
  title: "Going live: anyone on the internet reaches https://ourlittletribe.<tailnet>.ts.net. A second, unprivileged Tailscale node named ourlittletribe runs on the Thor beside the Thor's own node, and its Funnel forwards to the app on 127.0.0.1:8090. The Tigress Cub keeps the Thor's own name.",
  regions: [{ x: 200, y: 20, w: 740, h: 320, label: "Jetson AGX Thor: systemd user services" }],
  nodes: [
    { id: "internet", x: 15, y: 140, w: 160, h: 80, label: "Anyone", sub: ["ourlittletribe.", "taildb9a39.ts.net"], kind: "person" },
    { id: "node", x: 230, y: 60, w: 230, h: 80, label: "ourlittletribe-tailscale", sub: ["tailscaled, userspace", "Funnel :443 → :8090"], kind: "service" },
    { id: "app", x: 520, y: 60, w: 200, h: 80, label: "ourlittletribe", sub: ["127.0.0.1:8090", "Rust binary"] },
    { id: "model", x: 760, y: 60, w: 170, h: 80, label: "thor-edge-llm", sub: ["127.0.0.1:8081", "Qwen3.6"], kind: "model" },
    { id: "thornode", x: 230, y: 220, w: 230, h: 80, label: "Thor's own tailscaled", sub: ["arpanpathak.…ts.net", "Funnel :443 → Cub"], kind: "service" },
    { id: "cub", x: 520, y: 220, w: 200, h: 80, label: "Tigress Cub", sub: "127.0.0.1:8080", kind: "plain" },
  ],
  edges: [
    ["internet", "node", { label: "HTTPS" }],
    ["node", "app"],
    ["app", "model"],
    ["internet", "thornode", { dashed: true }],
    ["thornode", "cub"],
  ],
});

console.log("wrote figures to", out);
