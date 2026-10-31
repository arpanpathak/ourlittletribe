// The getting-there tab: where you set off from, your driving route, and
// stores on the way that sell what you still need.

import type { LatLng as LeafletLatLng, LayerGroup, LeafletMouseEvent, Map as LeafletMap, Marker } from "leaflet";

import { events } from "../../api/client.js";
import type { Detour, LatLng, StoreStop, TripView } from "../../api/types.js";
import { PlaceSearch } from "../../components/place_search.js";
import { h, mount } from "../../dom.js";
import { distance, duration } from "../../format.js";
import { icon } from "../../icons.js";
import { createMap, currentPosition, directionsUrl, fitTo, routeLine, startPin, storePin } from "../../map.js";
import { actionButton, debounce } from "../../ui/controls.js";
import { errorMessage, toast } from "../../ui/feedback.js";
import { isSortedFor } from "./packing.js";
import { drawItineraryPins } from "./places.js";
import type { EventScreen, TabView } from "./screen.js";

const NO_TRIP: TripView = { route: null, stores: [], notice: null };

function detourText(detour: Detour): string {
  const time = detour.minutes < 1 ? "On your way" : `+${duration(detour.minutes)}`;
  switch (detour.kind) {
    case "routed":
      return time;
    case "estimated":
      return `${time} (est.)`;
  }
}

function detourTitle(detour: Detour): string {
  switch (detour.kind) {
    case "routed":
      return "Driving time added";
    case "estimated":
      return "Estimated from distance";
  }
}

function shopWords(tag: string): string {
  return tag.replace(/_/g, " ");
}

function point(latLng: LeafletLatLng): LatLng {
  return { lat: latLng.lat, lng: latLng.lng };
}

/** The tab, with its map and the two side cards. */
class GettingThere {
  private readonly mapElement = h("div", { class: "map map-lg" });
  private readonly mapBox = h("div", { class: "card card-tight map-box" }, this.mapElement);
  private readonly startSlot = h("div", { class: "stack" });
  private readonly tripSlot = h("div", { class: "stack" });

  private map: LeafletMap | null = null;
  private tripLayer: LayerGroup | null = null;
  private originMarker: Marker | null = null;
  /** Whether the next map click sets the starting point. */
  private picking = false;
  private readonly loadTripSoon = debounce(() => void this.loadTrip(), 250);

  constructor(private readonly screen: EventScreen) {}

  element(): HTMLElement {
    const startCard = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, "Your starting point")), h("div", { class: "card-body" }, this.startSlot));
    const tripCard = h("section", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, "Stores on your way")), h("div", { class: "card-body" }, this.tripSlot));
    return h("div", { class: "split-wide tab-body" }, h("div", { class: "stack-lg" }, this.mapBox), h("aside", { class: "stack-lg" }, startCard, tripCard));
  }

  start(): void {
    const map = createMap(this.mapElement, this.screen.detail.event.meeting_point, 11);
    this.map = map;
    drawItineraryPins(map, this.screen.detail);
    this.tripLayer = L.layerGroup().addTo(map);

    map.on("click", (clicked: LeafletMouseEvent) => this.onMapClick(clicked));
    this.drawOrigin();
    this.drawStart();
    this.loadTripSoon();
  }

  /* ── The starting point ─────────────────────────── */

  private get origin(): LatLng | null {
    return this.screen.detail.my_origin;
  }

  private setPicking(picking: boolean): void {
    this.picking = picking;
    this.mapBox.classList.toggle("map-picking", picking);
  }

  private onMapClick(clicked: LeafletMouseEvent): void {
    if (!this.picking) return;

    this.setPicking(false);
    void this.saveOrigin(point(clicked.latlng)).catch((error: unknown) => toast(errorMessage(error), "error"));
  }

  private async saveOrigin(origin: LatLng): Promise<void> {
    await events.setOrigin(this.screen.detail.event.id, origin);
    this.originChanged(origin);
  }

  private async clearOrigin(): Promise<void> {
    await events.clearOrigin(this.screen.detail.event.id);
    this.originChanged(null);
  }

  /** Records the new origin without redrawing the whole page, so the map stays put. */
  private originChanged(origin: LatLng | null): void {
    this.screen.detail.my_origin = origin;
    this.drawOrigin();
    this.drawStart();
    this.loadTripSoon();
  }

  private drawOrigin(): void {
    this.originMarker?.remove();
    this.originMarker = null;
    if (!this.origin || !this.map) return;

    this.originMarker = L.marker([this.origin.lat, this.origin.lng], { icon: startPin() }).addTo(this.map).bindTooltip("You start here");
  }

  private drawStart(): void {
    const search = new PlaceSearch({
      near: () => this.screen.detail.event.meeting_point,
      placeholder: "Search an address or town",
      onPick: (place) => void this.saveOrigin(place).catch((error: unknown) => toast(errorMessage(error), "error")),
    });

    const pickButton = h("button", { type: "button", class: "btn btn-sm" }, icon("pin", "sm"), "Pick on map");
    pickButton.addEventListener("click", () => {
      this.setPicking(!this.picking);
      pickButton.classList.toggle("btn-soft", this.picking);
      if (this.picking) toast("Click the map where you'll set off from");
    });

    const status = this.origin
      ? h("div", { class: "picked" }, icon("navigation"),
          h("div", { class: "grow" }, h("div", { class: "strong" }, "Starting point set"), h("div", { class: "small" }, "The route and store detours start here.")),
          actionButton("Clear", () => this.clearOrigin(), { class: "btn btn-sm btn-ghost" }))
      : h("p", { class: "small text-2" }, "Add where you'll leave from to see your route and stores along it. Without it, stores near the meeting point are shown.");

    const useLocation = actionButton([icon("locate", "sm"), "Use my location"], async () => this.saveOrigin(await currentPosition()), { class: "btn btn-sm" });
    mount(this.startSlot, status, search.element, h("div", { class: "row" }, useLocation, pickButton), h("p", { class: "tiny muted" }, "Only you see your starting point. It's deleted a day after the event."));
  }

  /* ── The trip ───────────────────────────────────── */

  private async loadTrip(): Promise<void> {
    if (!this.screen.detail.items.length) {
      this.drawTrip(NO_TRIP);
      return;
    }

    mount(this.tripSlot, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Looking for stores along your route…"));
    try {
      this.drawTrip(await events.trip(this.screen.detail.event.id));
    } catch (error) {
      mount(this.tripSlot, h("p", { class: "small text-danger" }, errorMessage(error)));
    }
  }

  private drawTripOnMap(trip: TripView): void {
    const { map, tripLayer } = this;
    if (!map || !tripLayer) return;

    tripLayer.clearLayers();
    const points: LatLng[] = [this.screen.detail.event.meeting_point];
    if (trip.route) {
      routeLine(tripLayer, trip.route.points);
      points.push(...trip.route.points);
    }
    if (this.origin) points.push(this.origin);

    trip.stores.forEach((stop, index) => {
      L.marker([stop.store.lat, stop.store.lng], { icon: storePin(index + 1) }).addTo(tripLayer).bindPopup(() => this.storePopup(stop));
      points.push(stop.store);
    });
    fitTo(map, points);
  }

  private storePopup(stop: StoreStop): HTMLElement {
    return h("div", {},
      h("div", { class: "strong" }, stop.store.name),
      h("div", { class: "small muted" }, `${shopWords(stop.store.shop_tag)} · ${detourText(stop.detour)}`),
      h("div", { class: "small" }, `For: ${stop.covers.join(", ")}`));
  }

  private storeRow(stop: StoreStop, index: number): HTMLElement {
    const { store } = stop;
    const links = h("div", { class: "row store-links" },
      h("a", { class: "small strong", href: directionsUrl(store, this.origin), target: "_blank", rel: "noopener" }, "Directions"),
      h("a", { class: "small", href: `https://www.openstreetmap.org/${store.osm_ref}`, target: "_blank", rel: "noopener" }, "Details"));

    return h("li", { class: "stop" },
      h("span", { class: "stop-n" }, String(index + 1)),
      h("div", { class: "item-text" },
        h("div", { class: "stop-title" }, h("span", { class: "strong ellipsis" }, store.name), h("span", { class: "detour", title: detourTitle(stop.detour) }, detourText(stop.detour))),
        h("div", { class: "small muted" }, [shopWords(store.shop_tag), store.address].filter(Boolean).join(" · ")),
        h("div", { class: "chips" }, stop.covers.map((name) => h("span", { class: "chip" }, name))),
        store.opening_hours ? h("div", { class: "tiny muted" }, store.opening_hours) : null,
        links));
  }

  private noStoresText(): string {
    const { items } = this.screen.detail;
    if (!items.length) return "Stores appear here once the packing list has items.";

    const needsSomething = items.some((item) => !isSortedFor(item, this.screen.me));
    return needsSomething ? "No matching stores found nearby." : "You're all set: everything on the list is sorted.";
  }

  private drawTrip(trip: TripView): void {
    this.drawTripOnMap(trip);

    const notice = trip.notice ? h("div", { class: "notice notice-warning" }, icon("info", "sm"), h("span", {}, trip.notice)) : null;
    const drive = trip.route
      ? h("div", { class: "info-item" }, h("span", { class: "info-icon" }, icon("route")),
          h("div", {}, h("div", { class: "strong" }, `${duration(trip.route.duration_minutes)} drive`), h("div", { class: "small muted" }, `${distance(trip.route.distance_km)} to the meeting point`)))
      : null;
    const stores = trip.stores.length ? h("ol", { class: "stops" }, trip.stores.map((stop, index) => this.storeRow(stop, index))) : h("p", { class: "small muted" }, this.noStoresText());

    mount(this.tripSlot, notice, drive, stores, h("p", { class: "tiny muted" }, "Stores from OpenStreetMap. Detours are driving times from OSRM."));
  }
}

/** The getting-there tab. */
export function gettingThereTab(screen: EventScreen): TabView {
  const tab = new GettingThere(screen);
  return { element: tab.element(), start: () => tab.start() };
}
