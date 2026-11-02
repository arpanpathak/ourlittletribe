// Events: every upcoming outing as a list by day, beside a map of where they meet.

import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";

import { discovery, events as eventsApi, tribes as tribesApi } from "../api/client.js";
import type { Event } from "../api/types.js";
import { eventRow } from "../components/cards.js";
import { h, mount } from "../dom.js";
import { dayHeading, formatWhen } from "../format.js";
import { icon } from "../icons.js";
import { createMap, eventPin, fitTo } from "../map.js";
import { replaceRoute } from "../session.js";
import { debounce, segmented } from "../ui/controls.js";
import { emptyState } from "../ui/feedback.js";

/** Which events the list shows. */
type Show = "all" | "mine" | "going";

/** Whether the page shows the list or the map; on wide screens it shows both. */
type Layout = "list" | "map";

const SHOWS: Show[] = ["all", "mine", "going"];

/** Events on one day. */
interface DayGroup {
  /** The day, such as "Saturday, 7 November". */
  heading: string;
  /** Its events, in time order. */
  events: Event[];
}

function parseShow(text: string | null): Show {
  return SHOWS.find((show) => show === text) ?? "all";
}

function byDay(events: Event[]): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const event of events) {
    const heading = dayHeading(event.starts_at);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.events.push(event);
    else groups.push({ heading, events: [event] });
  }
  return groups;
}

/** What to say when nothing is shown: a headline and a line under it. */
function nothingReason(show: Show): [string, string] {
  switch (show) {
    case "going":
      return ["You haven't said you're going to anything yet", "Open an event and press “I'm going”."];
    case "mine":
      return ["Nothing planned in your tribes", "Plan the next outing, or join more tribes."];
    case "all":
      return ["No upcoming events", "Be the first to plan one."];
  }
}

function popup(event: Event): HTMLElement {
  return h("div", {},
    h("div", { class: "strong" }, event.title),
    h("div", { class: "small muted" }, formatWhen(event.starts_at)),
    h("div", { class: "small muted" }, event.meeting_point.name),
    h("a", { href: `#/events/${event.id}`, class: "small strong" }, "Open event →"));
}

/** The events page. */
class Explore {
  private readonly list = h("div", { class: "explore-list stack" });
  private readonly page = h("div", { class: "explore", "data-view": "list" });
  private readonly map: LeafletMap;
  private readonly markerLayer: LayerGroup;
  /** Each shown event's pin, by event id. */
  private readonly markers = new Map<string, Marker>();
  /** The ids the search matched, or null when nothing is typed. */
  private matchingIds: Set<string> | null = null;
  /** Counts searches, so a slow answer to an old one is ignored. */
  private searchNumber = 0;
  /** Each shown event's row, by event id. */
  private readonly rows = new Map<string, HTMLElement>();

  constructor(view: HTMLElement, private readonly events: Event[], private readonly myTribes: Set<string>, private show: Show, private needle: string) {
    const mapElement = h("div", { class: "map map-full" });
    mount(this.page, this.list, h("div", { class: "explore-map" }, mapElement));
    mount(view, this.head(), this.toolbar(), this.page);

    this.map = createMap(mapElement);
    this.markerLayer = L.layerGroup().addTo(this.map);
    this.draw();

    if (this.needle) void this.searchText();
  }

  private head(): HTMLElement {
    return h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Events"), h("p", {}, "Upcoming outings across every tribe on this server.")),
      h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "New event"));
  }

  private toolbar(): HTMLElement {
    const search = h("input", { type: "search", placeholder: "Search events: any word, any spelling", value: this.needle, "aria-label": "Search events" });
    search.addEventListener("input", debounce(() => {
      this.needle = search.value.trim();
      this.syncUrl();
      void this.searchText();
    }, 200));

    const which = segmented<Show>([{ value: "all", label: "All" }, { value: "mine", label: "My tribes" }, { value: "going", label: "Going" }], this.show, (show) => {
      this.show = show;
      this.syncUrl();
      this.draw();
    }, "Which events");

    const layout = segmented<Layout>([{ value: "list", label: "List", icon: "list" }, { value: "map", label: "Map", icon: "map" }], "list", (value) => this.setLayout(value), "Show as");
    layout.classList.add("view-switch");

    return h("div", { class: "toolbar" }, h("div", { class: "input-wrap" }, icon("search"), search), which, h("div", { class: "grow" }), layout);
  }

  private setLayout(layout: Layout): void {
    this.page.dataset.view = layout;
    if (layout === "map") setTimeout(() => this.map.invalidateSize(), 50);
  }

  private syncUrl(): void {
    const parameters = new URLSearchParams();
    if (this.show !== "all") parameters.set("show", this.show);
    if (this.needle) parameters.set("q", this.needle);

    const query = parameters.toString();
    replaceRoute(`/events${query ? `?${query}` : ""}`);
  }

  /** Asks the server's index which events match the text, so any word in any form counts. */
  private async searchText(): Promise<void> {
    this.searchNumber += 1;
    const number = this.searchNumber;

    if (this.needle.length < 2) {
      this.matchingIds = null;
      this.draw();
      return;
    }

    const found = await discovery.search(this.needle).catch(() => null);
    if (number !== this.searchNumber) return;

    this.matchingIds = new Set((found?.events ?? []).map((event) => event.id));
    this.draw();
  }

  private matches(event: Event): boolean {
    const inScope = this.show === "all"
      || (this.show === "mine" && this.myTribes.has(event.tribe_id))
      || (this.show === "going" && event.my_rsvp === "going");
    if (!inScope) return false;

    return this.matchingIds === null || this.matchingIds.has(event.id);
  }

  /** Lights up an event's pin and row together. */
  private highlight(eventId: string, on: boolean): void {
    const marker = this.markers.get(eventId);
    marker?.getElement()?.classList.toggle("active", on);
    marker?.setZIndexOffset(on ? 1000 : 0);
    this.rows.get(eventId)?.classList.toggle("highlight", on);
  }

  private row(event: Event): HTMLElement {
    const row = eventRow(event, { timeOnly: true });
    row.addEventListener("mouseenter", () => this.highlight(event.id, true));
    row.addEventListener("mouseleave", () => this.highlight(event.id, false));
    this.rows.set(event.id, row);
    return row;
  }

  private drawList(shown: Event[]): void {
    this.rows.clear();
    if (shown.length) {
      mount(this.list, byDay(shown).map((group) => h("section", {}, h("div", { class: "date-group" }, group.heading), group.events.map((event) => this.row(event)))));
      return;
    }

    const [title, text] = this.needle ? ["No events match your search", "Try other words."] : nothingReason(this.show);
    const newButton = h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "New event");
    mount(this.list, h("div", { class: "card" }, emptyState("calendar", title, text, newButton)));
  }

  private drawPins(shown: Event[]): void {
    this.markerLayer.clearLayers();
    this.markers.clear();

    for (const event of shown) {
      const { lat, lng } = event.meeting_point;
      const marker = L.marker([lat, lng], { icon: eventPin(), title: event.title }).addTo(this.markerLayer);
      marker.bindPopup(() => popup(event));
      marker.on("mouseover", () => this.highlight(event.id, true));
      marker.on("mouseout", () => this.highlight(event.id, false));
      this.markers.set(event.id, marker);
    }

    fitTo(this.map, shown.map((event) => event.meeting_point), 50);
  }

  private draw(): void {
    const shown = this.events.filter((event) => this.matches(event));
    this.drawList(shown);
    this.drawPins(shown);
  }
}

/** Draws the events page. `query` may hold `show` (all, mine, going) and `q`. */
export async function renderExplore(view: HTMLElement, query: URLSearchParams): Promise<void> {
  const [events, tribes] = await Promise.all([eventsApi.list(), tribesApi.list()]);
  const myTribes = new Set(tribes.filter((tribe) => tribe.is_member).map((tribe) => tribe.id));
  new Explore(view, events, myTribes, parseShow(query.get("show")), query.get("q") ?? "");
}
