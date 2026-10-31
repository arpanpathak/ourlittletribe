// A place search box. As you type it shows OpenStreetMap matches at once,
// then asks the model what you meant ("mt rainier henry jackson" is the
// Jackson Visitor Center at Paradise) and puts those best matches on top
// when they arrive. Every result is a real place on the map.

import { api } from "../api.js";
import { h, mount, icon, debounce, toast } from "../ui.js";
import { currentPosition } from "../map.js";

const KIND_ICONS = { peak: "mountain", volcano: "mountain", park: "map", "nature reserve": "map", trailhead: "route", parking: "pin", cafe: "store", restaurant: "store", hotel: "store" };

function sameSpot(first, second) {
  return first.name.toLowerCase() === second.name.toLowerCase() && Math.abs(first.lat - second.lat) < 0.003 && Math.abs(first.lng - second.lng) < 0.003;
}

/**
 * Builds the box. `near()` returns the point to search around; `onPick(place)`
 * gets `{ name, detail, lat, lng }`. Returns `{ element, input, setText(text), clear() }`.
 */
export function placeSearch({ near, onPick, placeholder = "Search places: a trailhead, park, café, address…", autofocus = false }) {
  let plain = [];
  let best = [];
  let thinking = false;
  let note = null;
  let activeIndex = -1;
  let searchToken = 0;
  let shown = [];

  const input = h("input", {
    type: "text", placeholder, autocomplete: "off", spellcheck: "false",
    role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list",
  });
  const list = h("ul", { class: "combo-list", role: "listbox", hidden: true });

  function closeList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  }

  function row(place, index, isBest) {
    return h("li", {
      role: "option",
      "data-index": String(index),
      "aria-selected": index === activeIndex ? "true" : "false",
      onmousedown: (event) => {
        event.preventDefault();
        choose(index);
      },
    }, icon(isBest ? "sparkles" : KIND_ICONS[place.kind] || "pin"),
    h("div", { class: "grow" },
      h("div", { class: "strong" }, place.name),
      h("div", { class: "small" }, [place.detail, place.kind].filter(Boolean).join(" · "))));
  }

  function draw() {
    const others = plain.filter((place) => !best.some((top) => sameSpot(top, place)));
    shown = [...best, ...others];
    const rows = [
      h("li", { class: "combo-action", onmousedown: (event) => { event.preventDefault(); useMyLocation(); } },
        icon("locate"), h("div", {}, h("div", { class: "strong" }, "Use my current location"))),
    ];
    if (best.length) rows.push(h("li", { class: "combo-group" }, icon("sparkles", "sm"), "Best matches"));
    best.forEach((place, index) => rows.push(row(place, index, true)));
    if (thinking) rows.push(h("li", { class: "combo-note" }, h("span", { class: "spinner" }), "Finding what you meant…"));
    if (best.length && others.length) rows.push(h("li", { class: "combo-group" }, "Other matches"));
    others.forEach((place, offset) => rows.push(row(place, best.length + offset, false)));
    if (note) rows.push(h("li", { class: "combo-note" }, note));
    mount(list, rows);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function choose(index) {
    const place = shown[index];
    if (!place) return;
    closeList();
    input.value = place.name;
    onPick({ name: place.name, detail: place.detail, lat: place.lat, lng: place.lng });
  }

  async function useMyLocation() {
    closeList();
    try {
      const point = await currentPosition();
      input.value = "Looking up your location…";
      let found = null;
      try {
        found = await api.placeAt(point);
      } catch {
        found = null;
      }
      const name = found?.name || "My location";
      input.value = name;
      onPick({ name, detail: found?.detail || "", ...point });
    } catch (problem) {
      input.value = "";
      toast(problem.message, "error");
    }
  }

  // Plain matches come quickly; the model is asked only once typing pauses.
  const askModel = debounce(async (text, token) => {
    try {
      const found = await api.smartPlaces(text, near());
      if (token !== searchToken) return;
      best = found;
    } catch {
      if (token !== searchToken) return;
    }
    thinking = false;
    note = best.length || plain.length ? null : "Nothing found. Try other words, or click the map to drop a pin.";
    draw();
  }, 700);

  const search = debounce(async (text) => {
    const token = ++searchToken;
    best = [];
    if (text.trim().length < 3) {
      plain = [];
      thinking = false;
      note = text.trim() ? "Keep typing…" : null;
      draw();
      return;
    }
    thinking = true;
    note = null;
    draw();
    askModel(text, token);
    try {
      const found = await api.places(text, near());
      if (token !== searchToken) return;
      plain = found;
    } catch {
      if (token !== searchToken) return;
      plain = [];
    }
    draw();
  }, 250);

  input.addEventListener("input", () => search(input.value));
  input.addEventListener("focus", () => {
    if (!input.value.trim()) draw();
    else if (shown.length) draw();
  });
  input.addEventListener("blur", () => setTimeout(closeList, 150));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden) draw();
      activeIndex = Math.min(activeIndex + 1, shown.length - 1);
      draw();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!list.hidden && shown.length) choose(activeIndex >= 0 ? activeIndex : 0);
    } else if (event.key === "Escape") {
      closeList();
    }
  });
  if (autofocus) requestAnimationFrame(() => input.focus());

  return {
    element: h("div", { class: "combo" }, h("div", { class: "input-wrap" }, icon("search"), input), list),
    input,
    setText(text) {
      input.value = text || "";
    },
  };
}
