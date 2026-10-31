// Search across events, tribes, people and places on the map.

import { api } from "../api.js";
import { h, mount, icon, avatar, emptyState, tabBar, debounce } from "../ui.js";
import { createMap, pin, fitTo } from "../map.js";
import { replaceRoute } from "../app.js";
import { eventRow, tribeCard } from "../components/cards.js";

/** Draws the search page, starting with `initialQuery`. */
export async function renderSearch(view, initialQuery) {
  const input = h("input", { type: "search", value: initialQuery, placeholder: "Search events, tribes, people and places", "aria-label": "Search", style: "height:46px;font-size:16px" });
  const tabsSlot = h("div");
  const results = h("div", { style: "margin-top:20px" });
  let found = { events: [], tribes: [], people: [] };
  let places = [];
  let tab = "all";
  let token = 0;

  function placesSection() {
    const mapElement = h("div", { class: "map map-md" });
    const section = h("section", { class: "section" },
      h("h2", {}, "Places"),
      h("div", { class: "split-wide", style: "gap:16px" },
        h("div", { class: "card", style: "padding:6px" }, mapElement),
        h("div", { class: "card", style: "padding:6px" },
          places.map((place) =>
            h("div", { class: "list-row" },
              icon("pin"),
              h("div", { class: "grow" }, h("div", { class: "strong" }, place.name), h("div", { class: "small muted" }, [place.detail, place.kind].filter(Boolean).join(" · "))),
              h("a", { class: "btn btn-sm", href: `#/events/new?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}` }, "Plan here"))))));
    requestAnimationFrame(() => {
      const map = createMap(mapElement);
      for (const place of places) {
        L.marker([place.lat, place.lng], { icon: pin("event") }).addTo(map).bindPopup(() =>
          h("div", {}, h("div", { class: "strong" }, place.name), h("div", { class: "small muted" }, place.detail),
            h("a", { class: "small strong", href: `#/events/new?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}` }, "Plan an event here →")));
      }
      fitTo(map, places);
    });
    return section;
  }

  function draw() {
    const counts = { events: found.events.length, tribes: found.tribes.length, people: found.people.length, places: places.length };
    mount(tabsSlot, input.value.trim().length >= 2
      ? tabBar([["all", "All"], ["events", "Events", counts.events], ["tribes", "Tribes", counts.tribes], ["people", "People", counts.people], ["places", "Places", counts.places]], tab, (value) => {
          tab = value;
          draw();
        })
      : null);
    if (input.value.trim().length < 2) {
      mount(results, h("div", { class: "card" }, emptyState("search", "Search everything", "Find an event, a tribe, a person, or a place to plan your next outing.")));
      return;
    }
    const want = (kind) => tab === "all" || tab === kind;
    const sections = [];
    if (want("events") && found.events.length) sections.push(h("section", { class: "section" }, h("h2", {}, "Events"), h("div", { class: "stack", style: "gap:4px" }, found.events.map((event) => eventRow(event)))));
    if (want("tribes") && found.tribes.length) sections.push(h("section", { class: "section" }, h("h2", {}, "Tribes"), h("div", { class: "grid-cards" }, found.tribes.map((tribe) => tribeCard(tribe)))));
    if (want("people") && found.people.length) {
      sections.push(h("section", { class: "section" }, h("h2", {}, "People"),
        h("div", { class: "card card-pad" }, h("div", { class: "people-grid", style: "grid-template-columns:repeat(auto-fill,minmax(220px,1fr))" }, found.people.map((person) =>
          h("a", { class: "person", href: `#/people/${person.id}` }, avatar(person.name, 36),
            h("div", { style: "min-width:0" }, h("div", { class: "strong ellipsis" }, person.name), person.home_area ? h("div", { class: "tiny muted" }, person.home_area) : null)))))));
    }
    if (want("places") && places.length) sections.push(placesSection());
    mount(results, sections.length
      ? h("div", { class: "stack-lg", style: "gap:32px" }, sections)
      : h("div", { class: "card" }, emptyState("search", "No results", "Try a different word, or check the spelling.")));
  }

  async function run() {
    const text = input.value.trim();
    replaceRoute(`/search${text ? `?q=${encodeURIComponent(text)}` : ""}`);
    if (text.length < 2) {
      found = { events: [], tribes: [], people: [] };
      places = [];
      draw();
      return;
    }
    const mine = ++token;
    mount(results, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Searching…"));
    const [foundNow, placesNow] = await Promise.all([
      api.search(text).catch(() => ({ events: [], tribes: [], people: [] })),
      text.length >= 3 ? api.places(text).catch(() => []) : Promise.resolve([]),
    ]);
    if (mine !== token) return;
    found = foundNow;
    places = placesNow;
    draw();
  }

  input.addEventListener("input", debounce(run, 300));
  mount(view,
    h("div", { class: "page-head" }, h("h1", {}, "Search")),
    h("div", { class: "input-wrap" }, icon("search"), input),
    h("div", {}, tabsSlot, results));
  input.focus();
  run();
}
