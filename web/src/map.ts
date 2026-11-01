// Leaflet maps: street and terrain layers, pins, route lines and directions.
// Dark mode dims the tiles with a CSS filter. Leaflet is the global `L`.

import type { DivIcon, LatLngTuple, LayerGroup, Map as LeafletMap, TileLayer } from "leaflet";

import type { LatLng } from "./api/types.js";
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

/** Makes a map inside `element`, with a switch between streets and terrain and a trails layer to turn on. */
export function createMap(element: HTMLElement, center: LatLng = DEFAULT_CENTER, zoom = 11): LeafletMap {
  const map = L.map(element, { zoomControl: true, scrollWheelZoom: true, attributionControl: true });
  map.setView([center.lat, center.lng], zoom);

  const streets = streetLayer();
  streets.addTo(map);
  L.control.layers({ Streets: streets, Terrain: terrainLayer() }, { "Hiking trails": trailsOverlay() }, { position: "topright" }).addTo(map);
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

/** Asks the browser where the viewer is. */
export function currentPosition(timeoutMilliseconds = 8000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share your location"));
      return;
    }

    const succeed = (position: GeolocationPosition) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
    const fail = (problem: GeolocationPositionError) => {
      const blocked = problem.code === problem.PERMISSION_DENIED;
      reject(new Error(blocked ? "Location access was blocked. Allow it in the browser to use this." : "Couldn't get your location"));
    };
    navigator.geolocation.getCurrentPosition(succeed, fail, { timeout: timeoutMilliseconds, enableHighAccuracy: true });
  });
}
