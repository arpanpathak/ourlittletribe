// Where an event goes: a meeting point, then any stops on the way, optional
// stops, and the venue. Each place has its own search box; one map shows them
// all, numbered in order. Clicking the map places whichever row is selected,
// and every pin can be dragged.

import { api } from "../api.js";
import { h, mount, icon } from "../ui.js";
import { createMap, placePin, itineraryLine, fitTo, currentPosition, DEFAULT_CENTER } from "../map.js";
import { PLACE_KINDS, pinLabels } from "../stops.js";
import { placeSearch } from "./place_search.js";

const MOST_STOPS = 12;
const STOP_KINDS = ["stop", "optional", "venue"];
let nextRowId = 0;

/**
 * One row of the editor. `place` is `{ name, detail, lat, lng }` or null;
 * `query` is search text to show while there is no place yet.
 */
function newRow(kind, place = null, note = "", query = "") {
  nextRowId += 1;
  return { id: nextRowId, kind, place, note, query };
}

/** A stop as the server sends it, as a row. */
function rowFromStop(stop) {
  const place = { name: stop.name, detail: "", lat: stop.lat, lng: stop.lng };
  return newRow(stop.kind, place, stop.note || "");
}

/** An entry from the plan assistant (`{ place, query, kind, note }`) as a row. */
function rowFromDraft(kind, entry, note = "") {
  if (!entry) return newRow(kind);
  if (!entry.place) return newRow(kind, null, note, entry.query || "");

  const place = { name: entry.place.name, detail: entry.place.detail || "", lat: entry.place.lat, lng: entry.place.lng };
  return newRow(kind, place, note);
}

function pinName(point) {
  return `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

/**
 * Builds the editor from `meet` ({ name, lat, lng } or null) and `stops`
 * ([{ kind, name, lat, lng, note }]). Call `start()` once it is in the page.
 * `value()` returns `{ meet, stops }`, or null after showing what is missing.
 */
export function locationsEditor({ meet = null, stops = [] } = {}) {
  const rows = [newRow("meet", meet ? { detail: "", ...meet } : null), ...stops.map(rowFromStop)];
  const searches = new Map();
  let activeId = rows[0].id;
  let map = null;
  let pinLayer = null;
  let lookupToken = 0;

  const list = h("div", { class: "loc-list" });
  const addBar = h("div", { class: "loc-add" });
  const mapElement = h("div", { class: "map map-lg" });
  const hint = h("div", { class: "map-hint" });
  const error = h("div", { class: "form-error", hidden: true });

  /* ── Order and lookup ─────────────────────────── */

  /** The rows in itinerary order: the meeting point, the stops, then the venue. */
  function ordered() {
    const [meetRow, ...others] = rows;
    const between = others.filter((row) => row.kind !== "venue");
    const venue = others.filter((row) => row.kind === "venue");
    return [meetRow, ...between, ...venue];
  }

  function labels() {
    return pinLabels(ordered().map((row) => ({ kind: row.kind })));
  }

  function activeRow() {
    return rows.find((row) => row.id === activeId) || rows[0];
  }

  /** Where searches should look around: the map's centre once it exists. */
  function searchCenter() {
    if (map) return map.getCenter();

    const placed = rows.find((row) => row.place);
    return placed ? placed.place : DEFAULT_CENTER;
  }

  /* ── Changing places ──────────────────────────── */

  function setPlace(row, place, { moveMap = true } = {}) {
    row.place = place;
    row.query = "";
    error.hidden = true;
    searches.get(row.id)?.setText(place?.name || "");

    drawList();
    drawPins();

    if (map && place && moveMap) {
      map.setView([place.lat, place.lng], Math.max(map.getZoom(), 13));
    }
  }

  /** Places a row at a point picked on the map, then names it from the nearest address. */
  async function nameThePoint(row, point) {
    const token = ++lookupToken;
    setPlace(row, { name: "Dropped pin", detail: "Looking up the address…", ...point }, { moveMap: false });

    let found = null;
    try {
      found = await api.placeAt(point);
    } catch {
      found = null;
    }
    if (token !== lookupToken) return;

    const name = found?.name || pinName(point);
    setPlace(row, { name, detail: found?.detail || "", ...point }, { moveMap: false });
  }

  function activate(row, focus = false) {
    activeId = row.id;

    for (const element of list.children) {
      element.classList.toggle("active", Number(element.dataset.row) === row.id);
    }
    hint.textContent = `Click the map to place: ${PLACE_KINDS[row.kind].label}`;
    drawPins();

    if (focus) searches.get(row.id)?.input.focus();
    if (row.place && map) map.panTo([row.place.lat, row.place.lng]);
  }

  /** Moves a stop up (-1) or down (1), never past the meeting point or the venue. */
  function move(row, step) {
    const index = rows.indexOf(row);
    const target = index + step;
    if (target < 1 || target >= rows.length || rows[target].kind === "venue") return;

    rows.splice(index, 1);
    rows.splice(target, 0, row);
    drawList();
    drawPins();
  }

  function remove(row) {
    rows.splice(rows.indexOf(row), 1);
    searches.delete(row.id);
    if (activeId === row.id) activeId = rows[0].id;

    drawList();
    drawPins();
    drawAddBar();
  }

  function add(kind) {
    if (rows.length > MOST_STOPS) return;

    const row = newRow(kind);
    const venueIndex = rows.findIndex((existing) => existing.kind === "venue");
    if (kind === "venue" || venueIndex === -1) rows.push(row);
    else rows.splice(venueIndex, 0, row);

    activeId = row.id;
    drawList();
    drawAddBar();
    activate(row, true);
  }

  function changeKind(row, kind) {
    row.kind = kind;
    if (kind === "venue") {
      rows.splice(rows.indexOf(row), 1);
      rows.push(row);
    }

    drawList();
    drawPins();
    drawAddBar();
  }

  /* ── Drawing a row ────────────────────────────── */

  function searchFor(row) {
    if (!searches.has(row.id)) {
      const search = placeSearch({
        near: searchCenter,
        placeholder: row.kind === "meet" ? "Where should everyone meet?" : "Search for this stop…",
        onPick: (place) => {
          activate(row);
          setPlace(row, place);
        },
      });
      search.setText(row.place?.name || row.query || "");
      searches.set(row.id, search);
    }

    const search = searches.get(row.id);
    search.input.onfocus = () => {
      if (activeId !== row.id) activate(row);
    };
    return search;
  }

  function kindPicker(row) {
    if (row.kind === "meet") {
      return h("span", { class: "loc-kind" }, PLACE_KINDS.meet.label, h("span", { class: "loc-required" }, "Required"));
    }

    const venueTaken = rows.some((other) => other.kind === "venue" && other !== row);
    const options = STOP_KINDS.map((kind) => {
      const disabled = kind === "venue" && venueTaken;
      return h("option", { value: kind, selected: kind === row.kind ? true : null, disabled: disabled ? true : null }, PLACE_KINDS[kind].label);
    });

    return h("select", { class: "loc-kind-select", "aria-label": "Kind of stop", onchange: (event) => changeKind(row, event.target.value) }, options);
  }

  function toolButton(iconName, label, onClick, disabled = false) {
    const attributes = { type: "button", class: "btn btn-ghost btn-icon btn-sm", title: label, "aria-label": label, disabled: disabled ? true : null, onclick: onClick };
    return h("button", attributes, icon(iconName, "sm"));
  }

  function rowTools(row) {
    if (row.kind === "meet") return h("div", { class: "loc-tools" });

    const index = rows.indexOf(row);
    const movable = row.kind !== "venue";
    const atTop = index <= 1;
    const atBottom = index >= rows.length - 1 || rows[index + 1]?.kind === "venue";

    return h("div", { class: "loc-tools" },
      movable ? toolButton("chevronUp", "Move up", () => move(row, -1), atTop) : null,
      movable ? toolButton("chevronDown", "Move down", () => move(row, 1), atBottom) : null,
      toolButton("x", "Remove this stop", () => remove(row)));
  }

  function pickedLine(row) {
    if (!row.place) {
      return h("div", { class: "loc-picked loc-empty" }, icon("pin", "sm"), h("span", {}, "Search above, or click the map"));
    }

    const where = row.place.detail || `${row.place.lat.toFixed(5)}, ${row.place.lng.toFixed(5)}`;
    return h("div", { class: "loc-picked" }, icon("check", "sm"), h("span", {}, where));
  }

  function noteInput(row) {
    if (row.kind === "meet") return null;

    return h("input", {
      class: "loc-note",
      maxlength: 200,
      placeholder: "Note (optional), e.g. coffee and restrooms, 15 min",
      value: row.note,
      oninput: (event) => {
        row.note = event.target.value;
      },
    });
  }

  function rowElement(row, label) {
    const head = h("div", { class: "loc-head" }, kindPicker(row), rowTools(row));
    const body = h("div", { class: "loc-body" }, head, searchFor(row).element, pickedLine(row), noteInput(row));
    const badge = h("span", { class: `loc-badge loc-badge-${row.kind}` }, label);

    const element = h("div", { class: `loc-row loc-${row.kind}`, "data-row": String(row.id) }, badge, body);
    element.classList.toggle("active", row.id === activeId);
    element.addEventListener("click", (event) => {
      const onControl = event.target.closest("button, select, input");
      if (activeId !== row.id && !onControl) activate(row);
    });

    return element;
  }

  /* ── Drawing the list, the buttons and the map ── */

  function drawList() {
    const pinText = labels();
    mount(list, ordered().map((row, index) => rowElement(row, pinText[index])));
  }

  function drawAddBar() {
    const full = rows.length > MOST_STOPS;
    const hasVenue = rows.some((row) => row.kind === "venue");

    const addButton = (kind, disabled, title = null) =>
      h("button", { type: "button", class: "btn btn-sm", disabled: disabled ? true : null, title, onclick: () => add(kind) }, icon("plus", "sm"), PLACE_KINDS[kind].label);

    mount(addBar,
      h("span", { class: "small muted" }, "Add:"),
      addButton("stop", full),
      addButton("optional", full),
      addButton("venue", full || hasVenue, hasVenue ? "This event already has a venue" : null));
  }

  function drawPin(row, label) {
    const active = row.id === activeId;
    const marker = L.marker([row.place.lat, row.place.lng], {
      icon: placePin(row.kind, label, active),
      draggable: true,
      autoPan: true,
      zIndexOffset: active ? 1000 : 0,
    });

    marker.bindTooltip(`${PLACE_KINDS[row.kind].label}: ${row.place.name}`, { direction: "top", offset: [0, -30] });
    marker.on("click", () => activate(row));
    marker.on("dragend", () => {
      const moved = marker.getLatLng();
      activate(row);
      nameThePoint(row, { lat: moved.lat, lng: moved.lng });
    });
    marker.addTo(pinLayer);
  }

  function drawPins() {
    if (!map) return;
    pinLayer.clearLayers();

    const pinText = labels();
    const placed = [];
    ordered().forEach((row, index) => {
      if (!row.place) return;
      placed.push(row.place);
      drawPin(row, pinText[index]);
    });

    itineraryLine(pinLayer, placed);
  }

  function fitToPlaces() {
    const placed = rows.filter((row) => row.place).map((row) => row.place);
    if (map && placed.length > 1) fitTo(map, placed, 50);
    else if (map && placed.length === 1) map.setView([placed[0].lat, placed[0].lng], 13);
  }

  function showMissing(row) {
    const text = row.kind === "meet"
      ? "Choose where everyone meets: search, or click the map."
      : `Choose a place for “${PLACE_KINDS[row.kind].label}”, or remove it.`;

    mount(error, icon("alert"), h("span", {}, text));
    error.hidden = false;
    activate(row, true);
  }

  drawList();
  drawAddBar();

  /* ── What the form uses ───────────────────────── */

  function start() {
    const first = rows.find((row) => row.place)?.place;
    map = createMap(mapElement, first || DEFAULT_CENTER, first ? 12 : 10);
    pinLayer = L.layerGroup().addTo(map);

    map.on("click", (event) => nameThePoint(activeRow(), { lat: event.latlng.lat, lng: event.latlng.lng }));
    activate(activeRow());
    fitToPlaces();

    if (!first) {
      currentPosition(5000)
        .then((point) => {
          if (!rows.some((row) => row.place)) map.setView([point.lat, point.lng], 11);
        })
        .catch(() => {});
    }
  }

  /** Replaces every place with a draft from the plan assistant. */
  function set({ meet: draftMeet = null, stops: draftStops = [] }) {
    const newRows = [rowFromDraft("meet", draftMeet)];
    for (const stop of draftStops) {
      newRows.push(rowFromDraft(stop.kind, stop, stop.note || ""));
    }

    rows.splice(0, rows.length, ...newRows);
    searches.clear();
    activeId = (rows.find((row) => !row.place) || rows[0]).id;

    drawList();
    drawAddBar();
    activate(activeRow());
    fitToPlaces();
  }

  /** The places chosen so far, without checking for missing ones. */
  function peek() {
    const [meetRow, ...others] = ordered();
    const chosen = others.filter((row) => row.place);
    return {
      meet: meetRow.place,
      stops: chosen.map((row) => ({ kind: row.kind, name: row.place.name, note: row.note.trim() })),
    };
  }

  function value() {
    const missing = rows.find((row) => !row.place);
    if (missing) {
      showMissing(missing);
      return null;
    }

    const [meetRow, ...others] = ordered();
    const stopsOut = others.map((row) => ({ kind: row.kind, name: row.place.name, lat: row.place.lat, lng: row.place.lng, note: row.note.trim() }));
    return { meet: meetRow.place, stops: stopsOut };
  }

  const side = h("div", { class: "loc-side" }, list, addBar);
  const mapBox = h("div", { class: "map-wrap map-picking loc-map" }, mapElement, hint);
  const element = h("div", { class: "locations" }, error, h("div", { class: "loc-layout" }, side, mapBox));

  return { element, start, set, peek, value };
}
