// A place search box. As you type it shows OpenStreetMap matches at once,
// then asks the model what you meant ("mt rainier henry jackson" is the
// Jackson Visitor Center at Paradise) and puts those best matches on top
// when they arrive. Every result is a real place on the map.

import { places } from "../api/client.js";
import type { LatLng, PlaceMatch } from "../api/types.js";
import { h, mount } from "../dom.js";
import { icon, type IconName } from "../icons.js";
import { currentPosition } from "../map.js";
import { debounce } from "../ui/controls.js";
import { errorMessage, toast } from "../ui/feedback.js";

/** A place someone picked: its name, where it is, and a line about it. */
export interface PickedPlace extends LatLng {
  /** Its name. */
  name: string;
  /** Where it is, such as "Ashford, Washington". */
  detail: string;
}

/** What the search box needs from the page around it. */
export interface PlaceSearchOptions {
  /** Where to prefer places near, such as the map's centre. */
  near: () => LatLng | null;
  /** Called with the place someone picks. */
  onPick: (place: PickedPlace) => void;
  /** The empty box's hint. */
  placeholder?: string;
}

/** Where a search is up to. */
type SearchStatus =
  | { kind: "idle" }
  | { kind: "too_short" }
  | { kind: "searching" }
  | { kind: "done" };

const KIND_ICONS: Record<string, IconName> = {
  peak: "mountain",
  volcano: "mountain",
  park: "map",
  "nature reserve": "map",
  trailhead: "route",
  parking: "pin",
  cafe: "store",
  restaurant: "store",
  hotel: "store",
};

/** How long to wait after typing before asking the map, milliseconds. */
const PLAIN_PAUSE = 250;

/** How long to wait after typing before asking the model, milliseconds. */
const MODEL_PAUSE = 700;

function samePlace(first: PlaceMatch, second: PlaceMatch): boolean {
  const close = Math.abs(first.lat - second.lat) < 0.003 && Math.abs(first.lng - second.lng) < 0.003;
  return close && first.name.toLowerCase() === second.name.toLowerCase();
}

/** A search box with a list of matches under it. */
export class PlaceSearch {
  /** The box and its list, to put in a page. */
  readonly element: HTMLElement;
  /** The text box. */
  readonly input: HTMLInputElement;

  /** The list under the box. */
  private readonly list: HTMLUListElement;
  /** Matches from the map for the current text. */
  private plain: PlaceMatch[] = [];
  /** The model's best matches for the current text. */
  private best: PlaceMatch[] = [];
  /** Every match in the order shown, best matches first. */
  private shown: PlaceMatch[] = [];
  /** Where the current search is up to. */
  private status: SearchStatus = { kind: "idle" };
  /** The highlighted row, for the arrow keys; -1 for none. */
  private activeIndex = -1;
  /** Counts searches, so a slow answer to an old search is ignored. */
  private searchNumber = 0;

  constructor(private readonly options: PlaceSearchOptions) {
    const placeholder = options.placeholder ?? "Search places: a trailhead, park, café, address…";
    this.input = h("input", {
      type: "text",
      placeholder,
      autocomplete: "off",
      spellcheck: "false",
      role: "combobox",
      "aria-expanded": "false",
      "aria-autocomplete": "list",
    });
    this.list = h("ul", { class: "combo-list", role: "listbox", hidden: true });
    this.element = h("div", { class: "combo" }, h("div", { class: "input-wrap" }, icon("search"), this.input), this.list);

    this.listen();
  }

  /** Puts text in the box without searching. */
  setText(text: string): void {
    this.input.value = text;
  }

  private listen(): void {
    const searchSoon = debounce((text: string) => void this.search(text), PLAIN_PAUSE);
    const askModelSoon = debounce((text: string, number: number) => void this.askModel(text, number), MODEL_PAUSE);

    this.input.addEventListener("input", () => {
      searchSoon(this.input.value);
      askModelSoon(this.input.value, this.searchNumber + 1);
    });
    this.input.addEventListener("focus", () => this.draw());
    this.input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
    this.input.addEventListener("keydown", (event) => this.onKey(event));
  }

  private onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.shown.length - 1);
        this.draw();
        break;
      case "ArrowUp":
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.draw();
        break;
      case "Enter":
        event.preventDefault();
        if (!this.list.hidden && this.shown.length) this.choose(Math.max(this.activeIndex, 0));
        break;
      case "Escape":
        this.close();
        break;
    }
  }

  private async search(text: string): Promise<void> {
    this.searchNumber += 1;
    const number = this.searchNumber;
    this.best = [];

    if (text.trim().length < 3) {
      this.plain = [];
      this.status = text.trim() ? { kind: "too_short" } : { kind: "idle" };
      this.draw();
      return;
    }

    this.status = { kind: "searching" };
    this.draw();

    const found = await places.search(text, this.options.near()).catch(() => []);
    if (number !== this.searchNumber) return;
    this.plain = found;
    this.draw();
  }

  private async askModel(text: string, number: number): Promise<void> {
    if (text.trim().length < 3) return;

    const found = await places.bestMatches(text, this.options.near()).catch(() => []);
    if (number !== this.searchNumber) return;

    this.best = found;
    this.status = { kind: "done" };
    this.draw();
  }

  private async useMyLocation(): Promise<void> {
    this.close();
    try {
      const point = await currentPosition();
      this.input.value = "Looking up your location…";
      const found = await places.nearest(point).catch(() => null);

      const name = found?.name ?? "My location";
      this.input.value = name;
      this.options.onPick({ name, detail: found?.detail ?? "", ...point });
    } catch (error) {
      this.input.value = "";
      toast(errorMessage(error), "error");
    }
  }

  private choose(index: number): void {
    const place = this.shown[index];
    if (!place) return;

    this.close();
    this.input.value = place.name;
    this.options.onPick({ name: place.name, detail: place.detail, lat: place.lat, lng: place.lng });
  }

  private close(): void {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.activeIndex = -1;
  }

  private row(place: PlaceMatch, index: number, isBest: boolean): HTMLElement {
    const pick = (event: MouseEvent) => {
      event.preventDefault();
      this.choose(index);
    };
    const detail = [place.detail, place.kind].filter(Boolean).join(" · ");
    const rowIcon = isBest ? "sparkles" : (KIND_ICONS[place.kind] ?? "pin");

    return h("li", { role: "option", "aria-selected": index === this.activeIndex ? "true" : "false", onmousedown: pick },
      icon(rowIcon),
      h("div", { class: "grow" }, h("div", { class: "strong" }, place.name), h("div", { class: "small" }, detail)));
  }

  private statusRow(): HTMLElement | null {
    const nothingFound = this.best.length === 0 && this.plain.length === 0;

    switch (this.status.kind) {
      case "idle":
        return null;
      case "too_short":
        return h("li", { class: "combo-note" }, "Keep typing…");
      case "searching":
        return h("li", { class: "combo-note" }, h("span", { class: "spinner" }), "Finding what you meant…");
      case "done":
        return nothingFound ? h("li", { class: "combo-note" }, "Nothing found. Try other words, or click the map to drop a pin.") : null;
    }
  }

  private draw(): void {
    const others = this.plain.filter((place) => !this.best.some((top) => samePlace(top, place)));
    this.shown = [...this.best, ...others];

    const useLocation = (event: MouseEvent) => {
      event.preventDefault();
      void this.useMyLocation();
    };
    const rows: Array<HTMLElement | null> = [
      h("li", { class: "combo-action", onmousedown: useLocation }, icon("locate"), h("div", { class: "strong" }, "Use my current location")),
    ];

    if (this.best.length) rows.push(h("li", { class: "combo-group" }, icon("sparkles", "sm"), "Best matches"));
    this.best.forEach((place, index) => rows.push(this.row(place, index, true)));
    rows.push(this.statusRow());

    if (this.best.length && others.length) rows.push(h("li", { class: "combo-group" }, "Other matches"));
    others.forEach((place, offset) => rows.push(this.row(place, this.best.length + offset, false)));

    mount(this.list, rows);
    this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
  }
}
