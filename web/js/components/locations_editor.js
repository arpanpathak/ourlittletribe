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
let nextRowId = 0;

/**
 * Builds the editor from `meet` ({ name, lat, lng } or null) and `stops`
 * ([{ kind, name, lat, lng, note }]). Call `start()` once it is in the page.
 * `value()` returns `{ meet, stops }`, or null after showing what is missing.
 */
export function locationsEditor({ meet = null, stops = [] } = {}) {
  const rows = [
    { id: nextRowId++, kind: "meet", place: meet ? { detail: "", ...meet } : null, note: "" },
    ...stops.map((stop) => ({ id: nextRowId++, kind: stop.kind, place: { name: stop.name, detail: "", lat: stop.lat, lng: stop.lng }, note: stop.note || "" })),
  ];
  let activeId = rows[0].id;
  let map = null;
  let pinLayer = null;
  const markers = new Map();
  const searches = new Map();
  let lookupToken = 0;

  const list = h("div", { class: "loc-list" });
  const addBar = h("div", { class: "loc-add" });
  const mapElement = h("div", { class: "map map-lg" });
  const hint = h("div", { class: "map-hint" });
  const error = h("div", { class: "form-error", hidden: true });

  function ordered() {
    const [meetRow, ...others] = rows;
    return [meetRow, ...others.filter((row) => row.kind !== "venue"), ...others.filter((row) => row.kind === "venue")];
  }

  function center() {
    const placed = rows.find((row) => row.id === activeId && row.place) || rows.find((row) => row.place);
    if (map) return map.getCenter();
    return placed ? placed.place : DEFAULT_CENTER;
  }

  function setPlace(row, place, { moveMap = true } = {}) {
    row.place = place;
    error.hidden = true;
    searches.get(row.id)?.setText(place?.name || "");
    drawList();
    drawPins();
    if (map && place && moveMap) map.setView([place.lat, place.lng], Math.max(map.getZoom(), 13));
  }

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
    setPlace(row, { name: found?.name || `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`, detail: found?.detail || "", ...point }, { moveMap: false });
  }

  function activate(row, focus = false) {
    activeId = row.id;
    for (const element of list.children) element.classList.toggle("active", Number(element.dataset.row) === row.id);
    hint.textContent = `Click the map to place: ${PLACE_KINDS[row.kind].label}`;
    drawPins();
    if (focus) searches.get(row.id)?.input.focus();
    if (row.place && map) map.panTo([row.place.lat, row.place.lng]);
  }

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
    const row = { id: nextRowId++, kind, place: null, note: "" };
    if (kind === "venue") rows.push(row);
    else {
      const venueIndex = rows.findIndex((existing) => existing.kind === "venue");
      rows.splice(venueIndex === -1 ? rows.length : venueIndex, 0, row);
    }
    activeId = row.id;
    drawList();
    drawAddBar();
    activate(row, true);
  }

  function rowElement(row, label) {
    const kind = PLACE_KINDS[row.kind];
    if (!searches.has(row.id)) {
      searches.set(row.id, placeSearch({
        near: center,
        placeholder: row.kind === "meet" ? "Where should everyone meet?" : "Search for this stop…",
        onPick: (place) => {
          activate(row);
          setPlace(row, place);
        },
      }));
      searches.get(row.id).setText(row.place?.name || "");
    }
    const search = searches.get(row.id);
    search.input.onfocus = () => {
      if (activeId !== row.id) activate(row);
    };
    const index = rows.indexOf(row);
    const venueTaken = rows.some((other) => other.kind === "venue" && other !== row);
    const kindSelect = row.kind === "meet"
      ? null
      : h("select", {
          class: "loc-kind-select",
          "aria-label": "Kind of stop",
          onchange: (event) => {
            row.kind = event.target.value;
            if (row.kind === "venue") {
              rows.splice(rows.indexOf(row), 1);
              rows.push(row);
            }
            drawList();
            drawPins();
            drawAddBar();
          },
        }, ["stop", "optional", "venue"].map((value) =>
          h("option", { value, selected: value === row.kind ? true : null, disabled: value === "venue" && venueTaken ? true : null }, PLACE_KINDS[value].label)));
    const movable = row.kind !== "meet" && row.kind !== "venue";
    const element = h("div", {
      class: `loc-row loc-${row.kind}${row.id === activeId ? " active" : ""}`,
      "data-row": String(row.id),
      onclick: (event) => {
        if (activeId !== row.id && !event.target.closest("button, select, input")) activate(row);
      },
    },
    h("span", { class: `loc-badge loc-badge-${row.kind}` }, label),
    h("div", { class: "loc-body" },
      h("div", { class: "loc-head" },
        kindSelect || h("span", { class: "loc-kind" }, kind.label, h("span", { class: "loc-required" }, "Required")),
        h("div", { class: "loc-tools" },
          movable ? h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", title: "Move up", "aria-label": "Move up", disabled: index <= 1 ? true : null, onclick: () => move(row, -1) }, icon("chevronDown", "sm rot-180")) : null,
          movable ? h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", title: "Move down", "aria-label": "Move down", disabled: index >= rows.length - 1 || rows[index + 1]?.kind === "venue" ? true : null, onclick: () => move(row, 1) }, icon("chevronDown", "sm")) : null,
          row.kind !== "meet" ? h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", title: "Remove", "aria-label": "Remove this stop", onclick: () => remove(row) }, icon("x", "sm")) : null)),
      search.element,
      row.place
        ? h("div", { class: "loc-picked" }, icon("check", "sm"), h("span", {}, row.place.detail || `${row.place.lat.toFixed(5)}, ${row.place.lng.toFixed(5)}`))
        : h("div", { class: "loc-picked loc-empty" }, icon("pin", "sm"), h("span", {}, "Search above, or click the map")),
      row.kind !== "meet"
        ? h("input", { class: "loc-note", maxlength: 200, placeholder: "Note (optional), e.g. coffee and restrooms, 15 min", value: row.note, oninput: (event) => { row.note = event.target.value; } })
        : null));
    return element;
  }

  function drawList() {
    const places = ordered();
    const labels = pinLabels(places.map((row) => ({ kind: row.kind })));
    mount(list, places.map((row, index) => rowElement(row, labels[index])));
  }

  function drawAddBar() {
    const full = rows.length > MOST_STOPS;
    const hasVenue = rows.some((row) => row.kind === "venue");
    mount(addBar,
      h("span", { class: "small muted" }, "Add:"),
      h("button", { type: "button", class: "btn btn-sm", disabled: full ? true : null, onclick: () => add("stop") }, icon("plus", "sm"), "Stop on the way"),
      h("button", { type: "button", class: "btn btn-sm", disabled: full ? true : null, onclick: () => add("optional") }, icon("plus", "sm"), "Optional stop"),
      h("button", { type: "button", class: "btn btn-sm", disabled: full || hasVenue ? true : null, title: hasVenue ? "This event already has a venue" : null, onclick: () => add("venue") }, icon("plus", "sm"), "Event venue"));
  }

  function drawPins() {
    if (!map) return;
    pinLayer.clearLayers();
    markers.clear();
    const places = ordered();
    const labels = pinLabels(places.map((row) => ({ kind: row.kind })));
    const placed = [];
    places.forEach((row, index) => {
      if (!row.place) return;
      placed.push(row.place);
      const marker = L.marker([row.place.lat, row.place.lng], { icon: placePin(row.kind, labels[index], row.id === activeId), draggable: true, autoPan: true, zIndexOffset: row.id === activeId ? 1000 : 0 })
        .bindTooltip(`${PLACE_KINDS[row.kind].label}: ${row.place.name}`, { direction: "top", offset: [0, -30] })
        .addTo(pinLayer);
      marker.on("click", () => activate(row));
      marker.on("dragend", () => {
        const moved = marker.getLatLng();
        activate(row);
        nameThePoint(row, { lat: moved.lat, lng: moved.lng });
      });
      markers.set(row.id, marker);
    });
    itineraryLine(pinLayer, placed);
  }

  drawList();
  drawAddBar();

  return {
    element: h("div", { class: "locations" },
      error,
      h("div", { class: "loc-layout" },
        h("div", { class: "loc-side" }, list, addBar),
        h("div", { class: "map-wrap map-picking loc-map" }, mapElement, hint))),
    start() {
      const first = rows.find((row) => row.place)?.place;
      map = createMap(mapElement, first || DEFAULT_CENTER, first ? 12 : 10);
      pinLayer = L.layerGroup().addTo(map);
      map.on("click", (event) => {
        const row = rows.find((candidate) => candidate.id === activeId) || rows[0];
        nameThePoint(row, { lat: event.latlng.lat, lng: event.latlng.lng });
      });
      activate(rows.find((row) => row.id === activeId));
      const placed = rows.filter((row) => row.place).map((row) => row.place);
      if (placed.length > 1) fitTo(map, placed, 50);
      if (!first) {
        currentPosition(5000)
          .then((point) => {
            if (!rows.some((row) => row.place)) map.setView([point.lat, point.lng], 11);
          })
          .catch(() => {});
      }
    },
    value() {
      const missing = rows.find((row) => !row.place);
      if (missing) {
        mount(error, icon("alert"), h("span", {}, missing.kind === "meet" ? "Choose where everyone meets: search, or click the map." : `Choose a place for “${PLACE_KINDS[missing.kind].label}”, or remove it.`));
        error.hidden = false;
        activate(missing, true);
        return null;
      }
      const [meetRow, ...others] = ordered();
      return {
        meet: meetRow.place,
        stops: others.map((row) => ({ kind: row.kind, name: row.place.name, lat: row.place.lat, lng: row.place.lng, note: row.note.trim() })),
      };
    },
  };
}
