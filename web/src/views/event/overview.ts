// The overview tab: what the event is, the conditions, who's going, where it
// goes, and how the packing list is coming along.

import type { LatLngTuple, LayerGroup, Map as LeafletMap } from "leaflet";

import type { Attendee, Trail } from "../../api/types.js";
import { personTile } from "../../components/cards.js";
import { conditionsCard } from "../../components/conditions.js";
import { TrailsCard } from "../../components/trails.js";
import { h } from "../../dom.js";
import { count, formatLongDay, formatTime, relativeTime } from "../../format.js";
import { icon } from "../../icons.js";
import { createMap, fitTo } from "../../map.js";
import { renderMarkdown } from "../../markdown.js";
import { downloadCalendarFile } from "./calendar.js";
import { progressBar, sortedCount } from "./packing.js";
import { drawItineraryPins, itineraryList, tripDirections } from "./places.js";
import type { EventScreen, TabView } from "./screen.js";

function aboutCard(screen: EventScreen): HTMLElement {
  const { event, can_manage: canManage } = screen.detail;
  const edit = canManage ? h("a", { class: "btn btn-ghost btn-sm", href: `#/events/${event.id}/edit` }, icon("edit", "sm"), "Edit") : null;

  const emptyText = canManage ? "No description yet. Add details so people know what to expect." : "No description.";
  const text = event.description ? renderMarkdown(event.description) : h("p", { class: "muted" }, emptyText);

  return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, "About"), edit), h("div", { class: "card-body" }, text));
}

function attendeeTile(screen: EventScreen, person: Attendee): HTMLElement {
  const you = person.user_id === screen.me.id;
  return personTile({ id: person.user_id, name: you ? `${person.name} (you)` : person.name, avatar: person.avatar, line: "" }, 32);
}

function goingCard(screen: EventScreen): HTMLElement {
  const { attendees } = screen.detail;
  const people = attendees.length ? h("div", { class: "people-grid" }, attendees.map((person) => attendeeTile(screen, person))) : h("p", { class: "muted" }, "Nobody yet. Be the first.");
  return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, `Going · ${attendees.length}`)), h("div", { class: "card-body" }, people));
}

function whenAndWhereCard(screen: EventScreen, mapElement: HTMLElement): HTMLElement {
  const { event, stops } = screen.detail;
  const when = h("div", { class: "info-item" },
    h("span", { class: "info-icon" }, icon("calendar")),
    h("div", {}, h("div", { class: "strong" }, formatLongDay(event.starts_at)), h("div", { class: "small muted" }, `${formatTime(event.starts_at)} · ${relativeTime(event.starts_at)}`)));

  const buttons = h("div", { class: "row" },
    h("a", { class: "btn btn-sm grow", href: tripDirections(screen.detail), target: "_blank", rel: "noopener" }, icon("navigation", "sm"), stops.length ? "Trip directions" : "Directions"),
    h("button", { type: "button", class: "btn btn-sm grow", onclick: () => downloadCalendarFile(event) }, icon("download", "sm"), "Add to calendar"));

  return h("section", { class: "card" }, h("div", { class: "card-body stack" }, when, itineraryList(screen.detail), mapElement, buttons));
}

function packingSummary(screen: EventScreen): HTMLElement {
  const total = screen.detail.items.length;
  const sorted = sortedCount(screen.detail, screen.me);

  return h("section", { class: "card" }, h("div", { class: "card-body stack" },
    h("div", { class: "row-between" }, h("h3", {}, "Packing list"), h("span", { class: "small muted" }, count(total, "item"))),
    progressBar(sorted, total),
    h("p", { class: "small text-2" }, total ? `${sorted} of ${total} sorted for you.` : "Nothing on the list yet."),
    h("button", { type: "button", class: "btn btn-sm", onclick: () => screen.openTab("list") }, "Open the list", icon("arrowRight", "sm"))));
}

/** Draws the chosen trail on the event's map, or clears it. */
class TrailOnMap {
  private map: LeafletMap | null = null;
  private layer: LayerGroup | null = null;

  /** Starts drawing on `map`, once it exists. */
  attach(map: LeafletMap): void {
    this.map = map;
    this.layer = L.layerGroup().addTo(map);
  }

  show(trail: Trail | null): void {
    if (!this.map || !this.layer) return;
    this.layer.clearLayers();
    if (!trail) return;

    for (const segment of trail.segments) {
      const line: LatLngTuple[] = segment.map((point) => [point.lat, point.lng]);
      L.polyline(line, { color: "#ffffff", weight: 7, opacity: 0.9 }).addTo(this.layer);
      L.polyline(line, { color: "#c8571f", weight: 4 }).addTo(this.layer);
    }
    fitTo(this.map, trail.segments.flat(), 30);
  }
}

/** The overview tab. */
export function overviewTab(screen: EventScreen): TabView {
  const { detail } = screen;
  const mapElement = h("div", { class: detail.stops.length ? "map map-md" : "map map-sm" });
  const trailOnMap = new TrailOnMap();
  const trails = new TrailsCard(detail.event.id, (trail) => {
    trailOnMap.show(trail);
    if (trail) mapElement.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const main = h("div", { class: "stack-lg" }, aboutCard(screen), conditionsCard(detail), trails.element, goingCard(screen));
  const side = h("aside", { class: "sticky-col" }, whenAndWhereCard(screen, mapElement), packingSummary(screen));

  const start = () => {
    const map = createMap(mapElement, detail.event.meeting_point, 13);
    const places = drawItineraryPins(map, detail);
    if (places.length > 1) fitTo(map, places, 30);

    trailOnMap.attach(map);
  };
  return { element: h("div", { class: "split tab-body" }, main, side), start };
}
