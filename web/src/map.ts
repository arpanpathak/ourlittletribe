// Leaflet maps: street and terrain layers, pins, route lines and directions.
// Dark mode dims the tiles with a CSS filter. Leaflet is the global `L`.

import type { DivIcon, LatLngTuple, LayerGroup, Map as LeafletMap, TileLayer } from "leaflet";

import type { LatLng } from "./api/types.js";
import { h, mount } from "./dom.js";
import { iconMarkup } from "./icons.js";
import type { PlaceKind } from "./itinerary.js";

const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Seattle, used before anything better is known. */
export const DEFAULT_CENTER: LatLng = { lat: 47.6062, lng: -122.3321 };

function streetLayer(): TileLayer {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: ATTRIBUTION });
}

function terrainLayer(): TileLayer {
  const attribution = `${ATTRIBUTION}, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a>`;
  return L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution });
}

/** Marked hiking routes drawn over the map, from Waymarked Trails. */
function trailsOverlay(): TileLayer {
  const attribution = '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>';
  return L.tileLayer("https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png", { maxZoom: 18, opacity: 0.85, attribution });
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/** Aerial photos, with roads and place names on top so a car park or trailhead has context. */
function satelliteLayer(): LayerGroup {
  const attribution = "Imagery © Esri, Maxar, Earthstar Geographics";
  const imagery = L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution });
  const roads = L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, opacity: 0.7 });
  const names = L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 });

  return L.layerGroup([imagery, roads, names]);
}

/** The base pictures a map can show. */
type BaseLayer = "map" | "terrain" | "satellite";

const BASE_NAMES: Record<BaseLayer, string> = { map: "Map", terrain: "Terrain", satellite: "Satellite" };

/** Buttons on the map to choose the base picture and turn trails on and off; big enough for a finger. */
function addLayerSwitcher(map: LeafletMap): void {
  const bases: Record<BaseLayer, TileLayer | LayerGroup> = { map: streetLayer(), terrain: terrainLayer(), satellite: satelliteLayer() };
  const trails = trailsOverlay();
  let shown: BaseLayer = "map";
  bases.map.addTo(map);

  const panel = h("div", { class: "map-switcher" });

  const draw = () => {
    const baseButtons = (Object.keys(bases) as BaseLayer[]).map((base) =>
      h("button", { type: "button", class: base === shown ? "active" : null, "aria-pressed": String(base === shown), onclick: () => choose(base) }, BASE_NAMES[base]));
    const trailsOn = map.hasLayer(trails);
    const trailButton = h("button", { type: "button", class: trailsOn ? "active trail-toggle" : "trail-toggle", "aria-pressed": String(trailsOn), onclick: toggleTrails }, "Trails");

    mount(panel, h("div", { class: "map-switcher-bases" }, baseButtons), trailButton);
  };

  const choose = (base: BaseLayer) => {
    map.removeLayer(bases[shown]);
    bases[base].addTo(map);
    shown = base;
    if (map.hasLayer(trails)) trails.bringToFront();
    draw();
  };

  const toggleTrails = () => {
    if (map.hasLayer(trails)) map.removeLayer(trails);
    else trails.addTo(map);
    draw();
  };

  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  const control = new L.Control({ position: "topright" });
  control.onAdd = () => panel;
  control.addTo(map);
  draw();
}

/** Makes a map inside `element`, with buttons for map, terrain and satellite views and a trails layer. */
export function createMap(element: HTMLElement, center: LatLng = DEFAULT_CENTER, zoom = 11): LeafletMap {
  const map = L.map(element, { zoomControl: true, scrollWheelZoom: true, attributionControl: true });
  map.setView([center.lat, center.lng], zoom);

  addLayerSwitcher(map);
  map.attributionControl.setPrefix(false);

  // The map's box may still be settling when it is made.
  new ResizeObserver(() => map.invalidateSize()).observe(element);
  return map;
}

function pinIcon(className: string, inner: string): DivIcon {
  return L.divIcon({
    className: `pin ${className}`,
    html: `<div class="pin-body">${inner}</div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
}

/** The pin for where a person starts. */
export function startPin(): DivIcon {
  return pinIcon("pin-start", iconMarkup("navigation"));
}

/** A numbered pin for a store. */
export function storePin(number: number): DivIcon {
  return pinIcon("pin-store", `<span>${number}</span>`);
}

/** The pin for an event on the events map. */
export function eventPin(active = false): DivIcon {
  return pinIcon(active ? "pin-event active" : "pin-event", iconMarkup("mountain"));
}

/** The pin for one of an event's places, showing its label (M, 1, 2…, V). */
export function placePin(kind: PlaceKind, label: string, active = false): DivIcon {
  const safeLabel = label.replace(/[^0-9A-Z]/g, "");
  return pinIcon(`pin-place pin-${kind}${active ? " active" : ""}`, `<span>${safeLabel}</span>`);
}

/** Draws a driving route into `layer`: a white casing under a blue line. */
export function routeLine(layer: LayerGroup, points: LatLng[]): void {
  const coordinates: LatLngTuple[] = points.map((point) => [point.lat, point.lng]);
  L.polyline(coordinates, { color: "#ffffff", weight: 8, opacity: 0.9 }).addTo(layer);
  L.polyline(coordinates, { color: "#2563a8", weight: 4.5, opacity: 0.95 }).addTo(layer);
}

/** Draws a dashed line through an itinerary's places, in order. */
export function itineraryLine(layer: LayerGroup, points: LatLng[]): void {
  if (points.length < 2) return;
  const coordinates: LatLngTuple[] = points.map((point) => [point.lat, point.lng]);
  L.polyline(coordinates, { color: "#6b7a74", weight: 3, opacity: 0.85, dashArray: "6 8" }).addTo(layer);
}

/** Zooms to show every point. */
export function fitTo(map: LeafletMap, points: LatLng[], padding = 40): void {
  const [only] = points;
  if (!only) return;

  if (points.length === 1) {
    map.setView([only.lat, only.lng], Math.max(map.getZoom(), 13));
    return;
  }
  const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as LatLngTuple));
  map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 14 });
}

/** A Google Maps link with directions to `to`, from `from` when known. */
export function directionsUrl(to: LatLng, from: LatLng | null = null): string {
  const origin = from ? `&origin=${from.lat},${from.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}${origin}`;
}

/** A Google Maps link with directions through `points` in order; the last is the destination. */
export function itineraryUrl(points: LatLng[]): string {
  const destination = points[points.length - 1] ?? DEFAULT_CENTER;
  const waypoints = points.slice(0, -1).map((point) => `${point.lat},${point.lng}`).join("|");
  const waypointPart = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}${waypointPart}`;
}

/** How old a position the browser may hand back, milliseconds: where you were ten minutes ago is close enough to plan from. */
const RECENT_POSITION_MS = 10 * 60 * 1000;

/** The last position found on this page, so asking again is instant. */
let lastPosition: { point: LatLng; at: number } | null = null;

/** One request to the browser for the viewer's position. */
function askBrowser(precise: boolean, timeoutMilliseconds: number): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    const succeed = (position: GeolocationPosition) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
    const options = { enableHighAccuracy: precise, timeout: timeoutMilliseconds, maximumAge: RECENT_POSITION_MS };
    navigator.geolocation.getCurrentPosition(succeed, reject, options);
  });
}

/** What to tell the viewer when the browser gave no position. */
function locationProblem(problem: unknown): Error {
  const denied = problem instanceof GeolocationPositionError && problem.code === problem.PERMISSION_DENIED;
  if (denied) return new Error("Location is turned off for this site. Allow it in the browser's site settings, then try again.");

  return new Error("Couldn't find your location. Check that location is on for your device, or search for a place instead.");
}

/**
 * Asks the browser where the viewer is. A quick, approximate fix comes
 * first, from Wi-Fi or the network, which is all a desktop has and is
 * enough to plan from; a precise GPS fix is asked for only if that fails.
 */
export async function currentPosition(timeoutMilliseconds = 10000): Promise<LatLng> {
  if (lastPosition && Date.now() - lastPosition.at < RECENT_POSITION_MS) return lastPosition.point;

  if (!window.isSecureContext) {
    throw new Error("Browsers share your location only with secure (https://) addresses. Open the app at its https:// address to use it.");
  }
  if (!navigator.geolocation) throw new Error("This browser can't share your location");

  let point: LatLng;
  try {
    point = await askBrowser(false, timeoutMilliseconds);
  } catch (quickProblem) {
    const denied = quickProblem instanceof GeolocationPositionError && quickProblem.code === quickProblem.PERMISSION_DENIED;
    if (denied) throw locationProblem(quickProblem);

    point = await askBrowser(true, timeoutMilliseconds * 2).catch((preciseProblem: unknown) => {
      throw locationProblem(preciseProblem);
    });
  }

  lastPosition = { point, at: Date.now() };
  return point;
}
