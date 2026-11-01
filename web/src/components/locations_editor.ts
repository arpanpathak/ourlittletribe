// Where an event goes: a meeting point, then stops on the way, optional stops
// and the venue. Each place has its own search box; one map shows them all,
// numbered in order. Clicking the map places whichever row is selected, and
// every pin can be dragged.

import type { LayerGroup, LeafletMouseEvent, Map as LeafletMap, Marker } from "leaflet";

import { places } from "../api/client.js";
import type { DraftPlace, DraftStop, LatLng, NewStop, Place, Stop, StopKind } from "../api/types.js";
import { h, mount } from "../dom.js";
import { icon, type IconName } from "../icons.js";
import { PLACE_KINDS, inStageOrder, pinLabels, stage, type PlaceKind } from "../itinerary.js";
import { DEFAULT_CENTER, createMap, currentPosition, fitTo, itineraryLine, placePin } from "../map.js";
import { PlaceSearch, type PickedPlace } from "./place_search.js";

/** Most places besides the meeting point. */
const MOST_STOPS = 16;

/** The kinds a row other than the meeting point can be. */
const STOP_KINDS: StopKind[] = ["pickup", "stop", "optional", "venue", "after"];

/** One row of the editor. */
interface Row {
  /** A number that tells rows apart. */
  id: number;
  /** What the place is for. */
  kind: PlaceKind;
  /** The chosen place, once there is one. */
  place: PickedPlace | null;
  /** A line from the planner. */
  note: string;
  /** Search text to show while there is no place yet, such as a drafted name. */
  query: string;
}

/** The places chosen, ready to save. */
export interface ChosenPlaces {
  /** Where everyone meets. */
  meetingPoint: Place;
  /** The other places, in order. */
  stops: NewStop[];
}

/** The places chosen so far, for describing the plan to the model. */
export interface PlacesSoFar {
  /** The meeting point, if chosen. */
  meetingPoint: PickedPlace | null;
  /** The other places that have been chosen, in order. */
  stops: Array<{ kind: StopKind; name: string; note: string }>;
}

let nextRowId = 0;

function newRow(kind: PlaceKind, place: PickedPlace | null = null, note = "", query = ""): Row {
  nextRowId += 1;
  return { id: nextRowId, kind, place, note, query };
}

function rowFromDraft(kind: PlaceKind, draft: DraftPlace | null, note = ""): Row {
  if (!draft) return newRow(kind);
  if (!draft.place) return newRow(kind, null, note, draft.query);
  return newRow(kind, { name: draft.place.name, detail: draft.place.detail, lat: draft.place.lat, lng: draft.place.lng }, note);
}

function pinName(point: LatLng): string {
  return `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

/** The editor for an event's places. */
export class LocationsEditor {
  /** The editor, to put in a form. */
  readonly element: HTMLElement;

  /** Every row, the meeting point first. */
  private rows: Row[];
  /** The row map clicks place. */
  private activeId: number;
  /** One search box per row, kept while the row lives. */
  private readonly searches = new Map<number, PlaceSearch>();
  /** The map, once `start()` has made it. */
  private map: LeafletMap | null = null;
  /** The layer holding the pins and the line. */
  private pinLayer: LayerGroup | null = null;
  /** Counts address lookups, so an old answer does not overwrite a newer pin. */
  private lookupNumber = 0;

  private readonly list = h("div", { class: "loc-list" });
  private readonly addBar = h("div", { class: "loc-add" });
  private readonly mapElement = h("div", { class: "map map-lg" });
  private readonly hint = h("div", { class: "map-hint" });
  private readonly error = h("div", { class: "form-error", hidden: true });

  constructor(meetingPoint: Place | null, stops: Stop[]) {
    const meetRow = newRow("meet", meetingPoint ? { ...meetingPoint, detail: "" } : null);
    const stopRows = stops.map((stop) => newRow(stop.kind, { name: stop.name, detail: "", lat: stop.lat, lng: stop.lng }, stop.note));
    this.rows = [meetRow, ...stopRows];
    this.activeId = meetRow.id;

    const side = h("div", { class: "loc-side" }, this.list, this.addBar);
    const mapBox = h("div", { class: "map-wrap map-picking loc-map" }, this.mapElement, this.hint);
    this.element = h("div", { class: "locations" }, this.error, h("div", { class: "loc-layout" }, side, mapBox));

    this.drawList();
    this.drawAddBar();
  }

  /* ── What the form uses ─────────────────────────── */

  /** Makes the map; call once the editor is in the page, so the map can measure itself. */
  start(): void {
    const first = this.rows.find((row) => row.place)?.place ?? null;
    const map = createMap(this.mapElement, first ?? DEFAULT_CENTER, first ? 12 : 10);
    this.map = map;
    this.pinLayer = L.layerGroup().addTo(map);

    map.on("click", (event: LeafletMouseEvent) => void this.nameThePoint(this.activeRow(), { lat: event.latlng.lat, lng: event.latlng.lng }));
    this.activate(this.activeRow());
    this.fitToPlaces();

    if (!first) void this.centreOnViewer();
  }

  /** Replaces every place with a draft from the plan assistant. */
  set(meetingPoint: DraftPlace | null, stops: DraftStop[]): void {
    this.rows = [rowFromDraft("meet", meetingPoint), ...stops.map((stop) => rowFromDraft(stop.kind, stop, stop.note))];
    this.sortRows();
    this.searches.clear();
    this.activeId = (this.rows.find((row) => !row.place) ?? this.activeRow()).id;

    this.drawList();
    this.drawAddBar();
    this.activate(this.activeRow());
    this.fitToPlaces();
  }

  /** The places chosen so far, without checking for missing ones. */
  peek(): PlacesSoFar {
    const [meetRow, ...others] = this.ordered();
    const chosen = others.flatMap((row) => (row.place && row.kind !== "meet" ? [{ kind: row.kind, name: row.place.name, note: row.note.trim() }] : []));
    return { meetingPoint: meetRow?.place ?? null, stops: chosen };
  }

  /** The places, or null after showing which one is missing. */
  value(): ChosenPlaces | null {
    const missing = this.rows.find((row) => !row.place);
    if (missing) {
      this.showMissing(missing);
      return null;
    }

    const [meetRow, ...others] = this.ordered();
    if (!meetRow?.place) return null;

    const stops: NewStop[] = others.flatMap((row) => {
      if (!row.place || row.kind === "meet") return [];
      return [{ kind: row.kind, name: row.place.name, lat: row.place.lat, lng: row.place.lng, note: row.note.trim() }];
    });
    return { meetingPoint: { name: meetRow.place.name, lat: meetRow.place.lat, lng: meetRow.place.lng }, stops };
  }

  /* ── Order and lookups ──────────────────────────── */

  /** The rows in itinerary order: the meeting point, then the others by stage. */
  private ordered(): Row[] {
    const [meetRow, ...others] = this.rows;
    return meetRow ? [meetRow, ...inStageOrder(others)] : [];
  }

  /** Keeps `rows` in itinerary order after a place is added or changes kind. */
  private sortRows(): void {
    this.rows = this.ordered();
  }

  /** Whether the row at `index` exists and is in the same stage as `row`, so they may swap. */
  private sameStageAt(index: number, row: Row): boolean {
    const other = this.rows[index];
    return index >= 1 && other !== undefined && stage(other.kind) === stage(row.kind);
  }

  private labels(): string[] {
    return pinLabels(this.ordered().map((row) => row.kind));
  }

  private activeRow(): Row {
    const meetRow = this.rows[0] ?? newRow("meet");
    return this.rows.find((row) => row.id === this.activeId) ?? meetRow;
  }

  /** Where searches look around: the map's centre once it exists. */
  private searchCentre(): LatLng {
    if (this.map) return this.map.getCenter();
    return this.rows.find((row) => row.place)?.place ?? DEFAULT_CENTER;
  }

  private async centreOnViewer(): Promise<void> {
    const point = await currentPosition(5000).catch(() => null);
    const nothingPlaced = !this.rows.some((row) => row.place);
    if (point && nothingPlaced) this.map?.setView([point.lat, point.lng], 11);
  }

  /* ── Changing places ────────────────────────────── */

  private setPlace(row: Row, place: PickedPlace | null, moveMap = true): void {
    row.place = place;
    row.query = "";
    this.error.hidden = true;
    this.searches.get(row.id)?.setText(place?.name ?? "");

    this.drawList();
    this.drawPins();

    if (this.map && place && moveMap) this.map.setView([place.lat, place.lng], Math.max(this.map.getZoom(), 13));
  }

  /** Places a row at a point picked on the map, then names it from the nearest address. */
  private async nameThePoint(row: Row, point: LatLng): Promise<void> {
    this.lookupNumber += 1;
    const number = this.lookupNumber;
    this.setPlace(row, { name: "Dropped pin", detail: "Looking up the address…", ...point }, false);

    const found = await places.nearest(point).catch(() => null);
    if (number !== this.lookupNumber) return;

    this.setPlace(row, { name: found?.name ?? pinName(point), detail: found?.detail ?? "", ...point }, false);
  }

  private activate(row: Row, focus = false): void {
    this.activeId = row.id;

    for (const element of this.list.children) {
      element.classList.toggle("active", Number((element as HTMLElement).dataset.row) === row.id);
    }
    this.hint.textContent = `Click the map to place: ${PLACE_KINDS[row.kind].label}`;
    this.drawPins();

    if (focus) this.searches.get(row.id)?.input.focus();
    if (row.place && this.map) this.map.panTo([row.place.lat, row.place.lng]);
  }

  /** Moves a place up (-1) or down (1) among places of its own stage. */
  private move(row: Row, step: -1 | 1): void {
    const index = this.rows.indexOf(row);
    const target = index + step;
    if (!this.sameStageAt(target, row)) return;

    this.rows.splice(index, 1);
    this.rows.splice(target, 0, row);
    this.drawList();
    this.drawPins();
  }

  private remove(row: Row): void {
    this.rows = this.rows.filter((other) => other !== row);
    this.searches.delete(row.id);
    if (this.activeId === row.id) this.activeId = this.activeRow().id;

    this.drawList();
    this.drawPins();
    this.drawAddBar();
  }

  private add(kind: StopKind): void {
    if (this.rows.length > MOST_STOPS) return;

    const row = newRow(kind);
    this.rows.push(row);
    this.sortRows();

    this.activeId = row.id;
    this.drawList();
    this.drawAddBar();
    this.activate(row, true);
  }

  private changeKind(row: Row, kind: StopKind): void {
    row.kind = kind;
    this.sortRows();

    this.drawList();
    this.drawPins();
    this.drawAddBar();
  }

  /* ── Drawing a row ──────────────────────────────── */

  private searchFor(row: Row): PlaceSearch {
    let search = this.searches.get(row.id);
    if (!search) {
      search = new PlaceSearch({
        near: () => this.searchCentre(),
        placeholder: row.kind === "meet" ? "Where should everyone meet?" : "Search for this stop…",
        onPick: (place) => {
          this.activate(row);
          this.setPlace(row, place);
        },
      });
      search.setText(row.place?.name ?? row.query);
      this.searches.set(row.id, search);
    }

    search.input.onfocus = () => {
      if (this.activeId !== row.id) this.activate(row);
    };
    return search;
  }

  private kindPicker(row: Row): HTMLElement {
    if (row.kind === "meet") {
      return h("span", { class: "loc-kind" }, PLACE_KINDS.meet.label, h("span", { class: "loc-required" }, "Required"));
    }

    const venueTaken = this.rows.some((other) => other.kind === "venue" && other !== row);
    const options = STOP_KINDS.map((kind) =>
      h("option", { value: kind, selected: kind === row.kind ? true : null, disabled: kind === "venue" && venueTaken ? true : null }, PLACE_KINDS[kind].label));
    const onchange = (event: globalThis.Event) => this.changeKind(row, (event.target as HTMLSelectElement).value as StopKind);

    return h("select", { class: "loc-kind-select", "aria-label": "Kind of stop", onchange }, options);
  }

  private toolButton(iconName: IconName, label: string, onClick: () => void, disabled = false): HTMLElement {
    return h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", title: label, "aria-label": label, disabled: disabled ? true : null, onclick: onClick }, icon(iconName, "sm"));
  }

  private rowTools(row: Row): HTMLElement {
    if (row.kind === "meet") return h("div", { class: "loc-tools" });

    const index = this.rows.indexOf(row);
    const movable = row.kind !== "venue";
    const atTop = !this.sameStageAt(index - 1, row);
    const atBottom = !this.sameStageAt(index + 1, row);

    return h("div", { class: "loc-tools" },
      movable ? this.toolButton("chevronUp", "Move up", () => this.move(row, -1), atTop) : null,
      movable ? this.toolButton("chevronDown", "Move down", () => this.move(row, 1), atBottom) : null,
      this.toolButton("x", "Remove this stop", () => this.remove(row)));
  }

  private pickedLine(row: Row): HTMLElement {
    if (!row.place) {
      return h("div", { class: "loc-picked loc-empty" }, icon("pin", "sm"), h("span", {}, "Search above, or click the map"));
    }
    const where = row.place.detail || `${row.place.lat.toFixed(5)}, ${row.place.lng.toFixed(5)}`;
    return h("div", { class: "loc-picked" }, icon("check", "sm"), h("span", {}, where));
  }

  private noteInput(row: Row): HTMLElement | null {
    if (row.kind === "meet") return null;

    const oninput = (event: globalThis.Event) => {
      row.note = (event.target as HTMLInputElement).value;
    };
    return h("input", { class: "loc-note", maxlength: 200, placeholder: "Note (optional), e.g. coffee and restrooms, 15 min", value: row.note, oninput });
  }

  private rowElement(row: Row, label: string): HTMLElement {
    const head = h("div", { class: "loc-head" }, this.kindPicker(row), this.rowTools(row));
    const body = h("div", { class: "loc-body" }, head, this.searchFor(row).element, this.pickedLine(row), this.noteInput(row));
    const badge = h("span", { class: `loc-badge loc-badge-${row.kind}` }, label);

    const element = h("div", { class: `loc-row loc-${row.kind}`, "data-row": String(row.id) }, badge, body);
    element.classList.toggle("active", row.id === this.activeId);
    element.addEventListener("click", (event) => {
      const onControl = (event.target as Element).closest("button, select, input");
      if (this.activeId !== row.id && !onControl) this.activate(row);
    });
    return element;
  }

  /* ── Drawing the list, the buttons and the map ──── */

  private drawList(): void {
    const labels = this.labels();
    mount(this.list, this.ordered().map((row, index) => this.rowElement(row, labels[index] ?? "")));
  }

  private drawAddBar(): void {
    const full = this.rows.length > MOST_STOPS;
    const hasVenue = this.rows.some((row) => row.kind === "venue");

    const addButton = (kind: StopKind, disabled: boolean, title: string | null = null) =>
      h("button", { type: "button", class: "btn btn-sm", disabled: disabled ? true : null, title, onclick: () => this.add(kind) }, icon("plus", "sm"), PLACE_KINDS[kind].label);

    mount(this.addBar,
      h("span", { class: "small muted" }, "Add:"),
      addButton("pickup", full),
      addButton("stop", full),
      addButton("optional", full),
      addButton("venue", full || hasVenue, hasVenue ? "This event already has a venue" : null),
      addButton("after", full));
  }

  private drawPin(row: Row, place: PickedPlace, label: string): void {
    if (!this.pinLayer) return;

    const active = row.id === this.activeId;
    const marker: Marker = L.marker([place.lat, place.lng], { icon: placePin(row.kind, label, active), draggable: true, autoPan: true, zIndexOffset: active ? 1000 : 0 });
    marker.bindTooltip(`${PLACE_KINDS[row.kind].label}: ${place.name}`, { direction: "top", offset: [0, -30] });
    marker.on("click", () => this.activate(row));
    marker.on("dragend", () => {
      const moved = marker.getLatLng();
      this.activate(row);
      void this.nameThePoint(row, { lat: moved.lat, lng: moved.lng });
    });
    marker.addTo(this.pinLayer);
  }

  private drawPins(): void {
    if (!this.pinLayer) return;
    this.pinLayer.clearLayers();

    const labels = this.labels();
    const placed: LatLng[] = [];
    this.ordered().forEach((row, index) => {
      if (!row.place) return;
      if (row.kind !== "pickup") placed.push(row.place);
      this.drawPin(row, row.place, labels[index] ?? "");
    });

    itineraryLine(this.pinLayer, placed);
  }

  private fitToPlaces(): void {
    const placed = this.rows.flatMap((row) => (row.place ? [row.place] : []));
    if (this.map && placed.length) fitTo(this.map, placed, 50);
  }

  private showMissing(row: Row): void {
    const text = row.kind === "meet" ? "Choose where everyone meets: search, or click the map." : `Choose a place for “${PLACE_KINDS[row.kind].label}”, or remove it.`;

    mount(this.error, icon("alert"), h("span", {}, text));
    this.error.hidden = false;
    this.activate(row, true);
  }
}
