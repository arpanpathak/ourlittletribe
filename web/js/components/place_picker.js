// Choosing a place: type to search, pick from suggestions, use your location,
// or click or drag on the map. A point picked on the map is named by looking
// up the nearest address.

import { api } from "../api.js";
import { h, mount, icon, debounce, toast } from "../ui.js";
import { createMap, pin, currentPosition, DEFAULT_CENTER } from "../map.js";

const KIND_ICONS = { peak: "mountain", park: "map", trailhead: "route", parking: "pin", cafe: "store", restaurant: "store" };

/**
 * Builds the picker. `initial` is `{ name, lat, lng }` or null.
 * Returns `{ element, value(), start() }`; call `start()` once the element is
 * in the page, so the map can measure itself.
 */
export function placePicker({ initial = null, label = "Location", placeholder = "Search for a trailhead, park, address…", onChange = () => {} } = {}) {
  let chosen = initial ? { ...initial } : null;
  let map = null;
  let marker = null;
  let suggestions = [];
  let activeIndex = -1;
  let lookupToken = 0;

  const input = h("input", {
    type: "text",
    placeholder,
    autocomplete: "off",
    role: "combobox",
    "aria-expanded": "false",
    "aria-autocomplete": "list",
    value: chosen?.name || "",
  });
  const list = h("ul", { class: "combo-list", role: "listbox", hidden: true });
  const summary = h("div");
  const mapElement = h("div", { class: "map map-md" });
  const hint = h("div", { class: "map-hint" }, "Click the map to drop the pin");
  const error = h("div", { class: "error", hidden: true });

  function drawSummary() {
    if (!chosen) {
      mount(summary);
      return;
    }
    mount(summary, h("div", { class: "picked" }, icon("pin"),
      h("div", { class: "grow" },
        h("div", { class: "strong" }, chosen.name || "Dropped pin"),
        h("div", { class: "small" }, chosen.detail || `${chosen.lat.toFixed(5)}, ${chosen.lng.toFixed(5)}`))));
  }

  function setChosen(place, { moveMap = true } = {}) {
    chosen = place;
    if (place.name) input.value = place.name;
    error.hidden = true;
    input.setAttribute("aria-invalid", "false");
    if (map) {
      if (marker) marker.setLatLng([place.lat, place.lng]);
      else {
        marker = L.marker([place.lat, place.lng], { icon: pin("event"), draggable: true, autoPan: true }).addTo(map);
        marker.on("dragend", () => {
          const moved = marker.getLatLng();
          nameThePoint({ lat: moved.lat, lng: moved.lng });
        });
      }
      if (moveMap) map.setView([place.lat, place.lng], Math.max(map.getZoom(), 14));
      hint.textContent = "Drag the pin or click the map to adjust";
    }
    drawSummary();
    onChange(chosen);
  }

  async function nameThePoint(point) {
    const token = ++lookupToken;
    setChosen({ name: "", detail: "Looking up the address…", ...point }, { moveMap: false });
    input.value = "";
    input.placeholder = "Looking up the address…";
    try {
      const found = await api.placeAt(point);
      if (token !== lookupToken) return;
      const name = found ? found.name : `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
      setChosen({ name, detail: found ? found.detail : "", ...point }, { moveMap: false });
    } catch {
      if (token !== lookupToken) return;
      setChosen({ name: `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`, detail: "", ...point }, { moveMap: false });
    } finally {
      input.placeholder = placeholder;
    }
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  }

  function highlight(index) {
    activeIndex = index;
    [...list.querySelectorAll("li[data-index]")].forEach((item) => {
      item.setAttribute("aria-selected", Number(item.dataset.index) === index ? "true" : "false");
    });
  }

  async function useMyLocation() {
    closeList();
    try {
      const point = await currentPosition();
      map?.setView([point.lat, point.lng], 15);
      await nameThePoint(point);
    } catch (problem) {
      toast(problem.message, "error");
    }
  }

  function drawList(note = null) {
    const rows = [
      h("li", { "data-index": "-2", onmousedown: (event) => { event.preventDefault(); useMyLocation(); } },
        icon("locate"), h("div", {}, h("div", { class: "strong" }, "Use my current location"))),
    ];
    if (note) rows.push(h("li", { class: "combo-note" }, note));
    suggestions.forEach((place, index) => {
      rows.push(h("li", {
        role: "option",
        "data-index": String(index),
        onmousedown: (event) => {
          event.preventDefault();
          choose(index);
        },
      }, icon(KIND_ICONS[place.kind] || "pin"),
      h("div", { class: "grow" },
        h("div", { class: "strong" }, place.name),
        h("div", { class: "small" }, [place.detail, place.kind].filter(Boolean).join(" · ")))));
    });
    mount(list, rows);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function choose(index) {
    const place = suggestions[index];
    if (!place) return;
    closeList();
    setChosen({ name: place.name, detail: place.detail, lat: place.lat, lng: place.lng });
  }

  const search = debounce(async (text) => {
    if (text.trim().length < 3) {
      suggestions = [];
      drawList(text.trim() ? "Keep typing…" : null);
      return;
    }
    drawList("Searching…");
    try {
      const center = map ? map.getCenter() : DEFAULT_CENTER;
      suggestions = await api.places(text, { lat: center.lat, lng: center.lng });
      drawList(suggestions.length ? null : "No places found. Try other words, or click the map.");
    } catch (problem) {
      suggestions = [];
      drawList(problem.message);
    }
  }, 280);

  input.addEventListener("input", () => {
    if (chosen && input.value !== chosen.name) {
      chosen = null;
      drawSummary();
      onChange(null);
    }
    search(input.value);
  });
  input.addEventListener("focus", () => {
    if (!chosen) drawList();
  });
  input.addEventListener("blur", () => setTimeout(closeList, 120));
  input.addEventListener("keydown", (event) => {
    if (list.hidden && event.key === "ArrowDown") {
      drawList();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight(Math.min(activeIndex + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter") {
      if (!list.hidden && suggestions.length) {
        event.preventDefault();
        choose(activeIndex >= 0 ? activeIndex : 0);
      }
    } else if (event.key === "Escape") {
      closeList();
    }
  });

  const element = h("div", { class: "stack" },
    h("div", { class: "field" },
      h("label", { class: "field-label" }, label),
      h("div", { class: "combo" }, h("div", { class: "input-wrap" }, icon("search"), input), list),
      error),
    h("div", { class: "map-wrap map-picking" }, mapElement, hint),
    summary);

  return {
    element,
    value: () => (chosen ? { ...chosen, name: chosen.name || `Pin at ${chosen.lat.toFixed(4)}, ${chosen.lng.toFixed(4)}` } : null),
    showError(text) {
      error.hidden = false;
      error.textContent = text;
      input.setAttribute("aria-invalid", "true");
      input.focus();
    },
    start() {
      map = createMap(mapElement, chosen || DEFAULT_CENTER, chosen ? 14 : 10);
      map.on("click", (event) => nameThePoint({ lat: event.latlng.lat, lng: event.latlng.lng }));
      if (chosen) setChosen(chosen);
      else {
        drawSummary();
        currentPosition(5000)
          .then((point) => {
            if (!chosen) map.setView([point.lat, point.lng], 11);
          })
          .catch(() => {});
      }
    },
  };
}
