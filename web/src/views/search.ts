// Search across events, tribes, people and places on the map.

import { discovery, places as placesApi } from "../api/client.js";
import type { PlaceMatch, SearchResults } from "../api/types.js";
import { eventRow, personTile, tribeCard } from "../components/cards.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { createMap, eventPin, fitTo } from "../map.js";
import { replaceRoute } from "../session.js";
import { debounce, tabBar } from "../ui/controls.js";
import { emptyState } from "../ui/feedback.js";

/** Which results the page shows. */
type Tab = "all" | "events" | "tribes" | "people" | "places";

/** Fewest characters worth searching for. */
const SHORTEST = 2;

const NOTHING: SearchResults = { events: [], tribes: [], people: [] };

function planHereUrl(place: PlaceMatch): string {
  return `#/events/new?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}`;
}

function placeRow(place: PlaceMatch): HTMLElement {
  const detail = [place.detail, place.kind].filter(Boolean).join(" · ");
  return h("div", { class: "list-row" },
    icon("pin"),
    h("div", { class: "grow" }, h("div", { class: "strong" }, place.name), h("div", { class: "small muted" }, detail)),
    h("a", { class: "btn btn-sm", href: planHereUrl(place) }, "Plan here"));
}

function placePopup(place: PlaceMatch): HTMLElement {
  return h("div", {},
    h("div", { class: "strong" }, place.name),
    h("div", { class: "small muted" }, place.detail),
    h("a", { class: "small strong", href: planHereUrl(place) }, "Plan an event here →"));
}

function placesSection(places: PlaceMatch[]): HTMLElement {
  const mapElement = h("div", { class: "map map-md" });

  requestAnimationFrame(() => {
    const map = createMap(mapElement);
    for (const place of places) {
      L.marker([place.lat, place.lng], { icon: eventPin() }).addTo(map).bindPopup(() => placePopup(place));
    }
    fitTo(map, places);
  });

  return h("section", { class: "section" },
    h("h2", {}, "Places"),
    h("div", { class: "split-wide" }, h("div", { class: "card card-tight" }, mapElement), h("div", { class: "card card-tight" }, places.map(placeRow))));
}

/** The results in `extra` that `found` does not already have. */
function unseen(extra: SearchResults, found: SearchResults): SearchResults {
  const has = (list: Array<{ id: string }>, id: string) => list.some((item) => item.id === id);

  return {
    events: extra.events.filter((event) => !has(found.events, event.id)),
    tribes: extra.tribes.filter((tribe) => !has(found.tribes, tribe.id)),
    people: extra.people.filter((person) => !has(found.people, person.id)),
  };
}

function section(title: string, body: HTMLElement): HTMLElement {
  return h("section", { class: "section" }, h("h2", {}, title), body);
}

/** The search page's state and drawing. */
class SearchPage {
  private readonly input: HTMLInputElement;
  private readonly tabsSlot = h("div");
  private readonly results = h("div", { class: "search-results" });

  private found: SearchResults = NOTHING;
  /** More results for words the model said the search also means. */
  private related: SearchResults = NOTHING;
  /** Whether the model is still looking for related words. */
  private askingModel = false;
  private places: PlaceMatch[] = [];
  private tab: Tab = "all";
  /** Counts searches, so a slow answer to an old one is ignored. */
  private searchNumber = 0;

  constructor(view: HTMLElement, initialText: string) {
    this.input = h("input", { type: "search", class: "search-big", value: initialText, placeholder: "Search events, tribes, people and places", "aria-label": "Search" });
    this.input.addEventListener("input", debounce(() => void this.run(), 300));

    mount(view, h("div", { class: "page-head" }, h("h1", {}, "Search")), h("div", { class: "input-wrap" }, icon("search"), this.input), h("div", {}, this.tabsSlot, this.results));
    this.input.focus();
    void this.run();
  }

  private text(): string {
    return this.input.value.trim();
  }

  private wants(tab: Tab): boolean {
    return this.tab === "all" || this.tab === tab;
  }

  /** The sections for one set of results, each only if the tab wants it. */
  private resultSections(results: SearchResults): HTMLElement[] {
    const { events, tribes, people } = results;
    const shown: HTMLElement[] = [];

    if (this.wants("events") && events.length) {
      shown.push(section("Events", h("div", { class: "stack stack-tight" }, events.map((event) => eventRow(event)))));
    }
    if (this.wants("tribes") && tribes.length) {
      shown.push(section("Tribes", h("div", { class: "grid-cards" }, tribes.map((tribe) => tribeCard(tribe)))));
    }
    if (this.wants("people") && people.length) {
      const tiles = people.map((person) => personTile({ id: person.id, name: person.name, avatar: person.avatar, line: person.home_area }, 36));
      shown.push(section("People", h("div", { class: "card card-pad" }, h("div", { class: "people-grid" }, tiles))));
    }
    return shown;
  }

  /** The model's extra results, under their own heading, or a note that it is still looking. */
  private relatedSection(): HTMLElement | null {
    if (this.askingModel) {
      return h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Looking for related tribes and events…");
    }

    const extra = this.resultSections(this.related);
    if (!extra.length) return null;

    const head = h("div", { class: "related-head" }, icon("sparkles", "sm"), h("span", {}, "Related: found with other words for what you searched"));
    return h("div", { class: "related stack-lg" }, head, extra);
  }

  private sections(): HTMLElement[] {
    const shown = this.resultSections(this.found);
    const related = this.relatedSection();

    if (related) shown.push(related);
    if (this.wants("places") && this.places.length) shown.push(placesSection(this.places));
    return shown;
  }

  private drawTabs(): void {
    if (this.text().length < SHORTEST) {
      mount(this.tabsSlot);
      return;
    }

    const choices = [
      { value: "all" as const, label: "All" },
      { value: "events" as const, label: "Events", count: this.found.events.length },
      { value: "tribes" as const, label: "Tribes", count: this.found.tribes.length },
      { value: "people" as const, label: "People", count: this.found.people.length },
      { value: "places" as const, label: "Places", count: this.places.length },
    ];
    mount(this.tabsSlot, tabBar<Tab>(choices, this.tab, (tab) => {
      this.tab = tab;
      this.draw();
    }));
  }

  private draw(): void {
    this.drawTabs();

    if (this.text().length < SHORTEST) {
      mount(this.results, h("div", { class: "card" }, emptyState("search", "Search everything", "Find an event, a tribe, a person, or a place to plan your next outing.")));
      return;
    }

    const shown = this.sections();
    if (!shown.length) {
      mount(this.results, h("div", { class: "card" }, emptyState("search", "No results", "Try a different word, or check the spelling.")));
      return;
    }
    mount(this.results, h("div", { class: "stack-lg" }, shown));
  }

  /** Asks the model for related results, then draws them under the direct ones. */
  private async askForRelated(text: string, number: number): Promise<void> {
    this.askingModel = true;
    this.draw();

    const extra = await discovery.related(text).catch(() => NOTHING);
    if (number !== this.searchNumber) return;

    this.related = unseen(extra, this.found);
    this.askingModel = false;
    this.draw();
  }

  private async run(): Promise<void> {
    const text = this.text();
    replaceRoute(`/search${text ? `?q=${encodeURIComponent(text)}` : ""}`);

    this.searchNumber += 1;
    const number = this.searchNumber;
    this.related = NOTHING;
    this.askingModel = false;

    if (text.length < SHORTEST) {
      this.found = NOTHING;
      this.places = [];
      this.draw();
      return;
    }

    mount(this.results, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Searching…"));
    const [found, places] = await Promise.all([
      discovery.search(text).catch(() => NOTHING),
      text.length >= 3 ? placesApi.search(text, null).catch(() => []) : Promise.resolve([]),
    ]);
    if (number !== this.searchNumber) return;

    this.found = found;
    this.places = places;
    this.draw();

    if (text.length >= 3) await this.askForRelated(text, number);
  }
}

/** Draws the search page, starting with `initialText`. */
export async function renderSearch(view: HTMLElement, initialText: string): Promise<void> {
  new SearchPage(view, initialText);
}
