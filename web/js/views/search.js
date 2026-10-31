// Search across tribes, upcoming events, people, and places on the map.

import { api } from "../api.js";
import { squatch } from "../art.js";
import { h, mount, avatar, debounce } from "../ui.js";
import { createMap, pin, fitTo } from "../map.js";
import { eventCard, tribeCard } from "./tribes.js";

/** Draws the search page, starting with `initialQuery`. */
export async function renderSearch(view, initialQuery) {
  const input = h("input", { type: "search", value: initialQuery, placeholder: "Tribes, events, people or places", "aria-label": "Search", autofocus: true });
  const results = h("div", { class: "stack-lg" });
  const mapElement = h("div", { class: "map map-search" });

  mount(view,
    h("div", { class: "search-page" },
      h("form", { class: "search-hero card" }, h("h1", {}, "Search"), input),
      h("div", { class: "event-grid" }, results, h("aside", { class: "map-column" }, h("section", { class: "card map-card" }, h("h3", {}, "Places"), mapElement)))));

  const map = createMap(mapElement);
  const placeLayer = L.layerGroup().addTo(map);

  async function run(query) {
    const text = query.trim();
    history.replaceState(null, "", `#/search${text ? `?q=${encodeURIComponent(text)}` : ""}`);
    if (text.length < 2) {
      mount(results, h("div", { class: "empty" }, h("div", { html: squatch("map", 110) }), h("p", {}, "Find a tribe, an outing, a person, or a trailhead.")));
      placeLayer.clearLayers();
      return;
    }
    mount(results, h("p", { class: "muted" }, h("span", { class: "spinner" }), " Searching…"));
    const [found, places] = await Promise.all([
      api.search(text).catch(() => ({ tribes: [], events: [], people: [] })),
      text.length >= 3 ? api.places(text).catch(() => []) : Promise.resolve([]),
    ]);
    placeLayer.clearLayers();
    for (const place of places) {
      L.marker([place.lat, place.lng], { icon: pin("meet") }).addTo(placeLayer).bindPopup(() => h("div", { class: "popup" }, place.name));
    }
    fitTo(map, places);
    const nothing = !found.tribes.length && !found.events.length && !found.people.length;
    mount(results,
      found.events.length ? h("section", {}, h("h2", { class: "section-title" }, "Events"), h("div", { class: "list" }, found.events.map(eventCard))) : null,
      found.tribes.length ? h("section", {}, h("h2", { class: "section-title" }, "Tribes"), h("div", { class: "grid" }, found.tribes.map(tribeCard))) : null,
      found.people.length
        ? h("section", {}, h("h2", { class: "section-title" }, "People"),
            h("ul", { class: "people card" }, found.people.map((person) =>
              h("li", {}, h("a", { class: "person", href: `#/people/${person.id}` }, avatar(person.name, 36), h("span", {}, person.name), h("span", { class: "muted small" }, person.home_area))))))
        : null,
      nothing ? h("div", { class: "empty" }, h("div", { html: squatch("think", 100) }), h("p", {}, places.length ? "No tribes or events match, but the map found places." : "Nothing matches yet.")) : null);
  }

  const runSoon = debounce(run, 350);
  input.addEventListener("input", () => runSoon(input.value));
  input.closest("form").addEventListener("submit", (event) => {
    event.preventDefault();
    run(input.value);
  });
  run(initialQuery);
}
