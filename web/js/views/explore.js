// Events: every upcoming outing as a list by day, beside a map of where they meet.

import { api } from "../api.js";
import { h, mount, icon, emptyState, segmented, dayHeading, formatWhen, debounce } from "../ui.js";
import { createMap, pin, fitTo } from "../map.js";
import { replaceRoute } from "../app.js";
import { eventRow } from "../components/cards.js";

const FILTERS = [
  ["all", "All"],
  ["mine", "My tribes"],
  ["going", "Going"],
];

/** Draws the events page. `query` may hold `show` (all, mine, going) and `q`. */
export async function renderExplore(view, query) {
  const [events, tribes] = await Promise.all([api.events(), api.tribes()]);
  const myTribes = new Set(tribes.filter((tribe) => tribe.is_member).map((tribe) => tribe.id));
  let show = FILTERS.some(([value]) => value === query.get("show")) ? query.get("show") : "all";
  let text = query.get("q") || "";
  let layout = "list";

  const listElement = h("div", { class: "explore-list stack" });
  const mapElement = h("div", { class: "map map-full" });
  const page = h("div", { class: "explore", "data-view": layout });
  const markers = new Map();
  let map = null;
  let markerLayer = null;

  function visible() {
    const needle = text.trim().toLowerCase();
    return events.filter((event) => {
      if (show === "mine" && !myTribes.has(event.tribe_id)) return false;
      if (show === "going" && event.my_rsvp !== "going") return false;
      if (!needle) return true;
      return [event.title, event.place_name, event.tribe_name, event.description].some((value) => value.toLowerCase().includes(needle));
    });
  }

  function syncUrl() {
    const parts = [];
    if (show !== "all") parts.push(`show=${show}`);
    if (text.trim()) parts.push(`q=${encodeURIComponent(text.trim())}`);
    replaceRoute(`/events${parts.length ? `?${parts.join("&")}` : ""}`);
  }

  function highlight(eventId, on) {
    const marker = markers.get(eventId);
    if (!marker) return;
    marker.getElement()?.classList.toggle("active", on);
    if (on) marker.setZIndexOffset(1000);
    else marker.setZIndexOffset(0);
  }

  function draw() {
    const shown = visible();
    const groups = [];
    for (const event of shown) {
      const heading = dayHeading(event.starts_at);
      const last = groups[groups.length - 1];
      if (last && last.heading === heading) last.events.push(event);
      else groups.push({ heading, events: [event] });
    }
    if (!shown.length) {
      const reason = {
        going: ["You haven't said you're going to anything yet", "Open an event and press “I'm going”."],
        mine: ["Nothing planned in your tribes", "Plan the next outing, or join more tribes."],
        all: ["No upcoming events", "Be the first to plan one."],
      }[show];
      mount(listElement, h("div", { class: "card" }, emptyState("calendar", text ? "No events match your search" : reason[0], text ? "Try other words." : reason[1],
        h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "New event"))));
    } else {
      mount(listElement, groups.map((group) =>
        h("section", {},
          h("div", { class: "date-group" }, group.heading),
          group.events.map((event) =>
            eventRow(event, {
              timeOnly: true,
              "data-id": event.id,
              onmouseenter: () => highlight(event.id, true),
              onmouseleave: () => highlight(event.id, false),
            })))));
    }
    if (map) {
      markerLayer.clearLayers();
      markers.clear();
      for (const event of shown) {
        const marker = L.marker([event.lat, event.lng], { icon: pin("event"), title: event.title }).addTo(markerLayer);
        marker.bindPopup(() =>
          h("div", {},
            h("div", { class: "strong" }, event.title),
            h("div", { class: "small muted" }, formatWhen(event.starts_at)),
            h("div", { class: "small muted" }, event.place_name),
            h("a", { href: `#/events/${event.id}`, class: "small strong" }, "Open event →")));
        marker.on("mouseover", () => listElement.querySelector(`[data-id="${event.id}"]`)?.classList.add("highlight"));
        marker.on("mouseout", () => listElement.querySelector(`[data-id="${event.id}"]`)?.classList.remove("highlight"));
        markers.set(event.id, marker);
      }
      fitTo(map, shown.map((event) => ({ lat: event.lat, lng: event.lng })), 50);
    }
  }

  const search = h("input", { type: "search", placeholder: "Filter by name, place or tribe", value: text, "aria-label": "Filter events" });
  search.addEventListener("input", debounce(() => {
    text = search.value;
    syncUrl();
    draw();
  }, 150));

  const viewSwitch = segmented([["list", "List", "list"], ["map", "Map", "map"]], layout, (value) => {
    layout = value;
    page.dataset.view = value;
    if (value === "map") setTimeout(() => map?.invalidateSize(), 50);
  }, "Show as");
  viewSwitch.classList.add("view-switch");

  mount(page, listElement, h("div", { class: "explore-map" }, mapElement));
  mount(view,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Events"), h("p", {}, "Upcoming outings across every tribe on this server.")),
      h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "New event")),
    h("div", { class: "toolbar" },
      h("div", { class: "input-wrap" }, icon("search"), search),
      segmented(FILTERS, show, (value) => {
        show = value;
        syncUrl();
        draw();
      }, "Which events"),
      h("div", { class: "grow" }),
      viewSwitch),
    page);

  map = createMap(mapElement);
  markerLayer = L.layerGroup().addTo(map);
  draw();
}
