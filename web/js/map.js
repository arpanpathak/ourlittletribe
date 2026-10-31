// Leaflet maps: street and terrain layers, pins, route lines. Dark mode dims
// the tiles with a CSS filter. Leaflet is loaded as a classic script (`L`).

import { iconMarkup } from "./icons.js";

const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const LAYERS = {
  Streets: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: ATTRIBUTION }),
  Terrain: () =>
    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: `${ATTRIBUTION}, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a>`,
    }),
};

/** Seattle, used before anything better is known. */
export const DEFAULT_CENTER = { lat: 47.6062, lng: -122.3321 };

/** Makes a map inside `element` with a street/terrain switch. */
export function createMap(element, center = DEFAULT_CENTER, zoom = 11, { layer = "Streets" } = {}) {
  const map = L.map(element, { zoomControl: true, scrollWheelZoom: true, attributionControl: true }).setView([center.lat, center.lng], zoom);
  const layers = {};
  for (const [name, build] of Object.entries(LAYERS)) layers[name] = build();
  layers[layer].addTo(map);
  L.control.layers(layers, {}, { position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  // The map's box may still be settling when it is created.
  const resize = new ResizeObserver(() => map.invalidateSize());
  resize.observe(element);
  return map;
}

/** A pin: `event`, `start`, or `store` with a number. */
export function pin(kind, label = "") {
  const inner = {
    event: iconMarkup("mountain"),
    start: iconMarkup("navigation"),
    store: `<span>${String(label).replace(/[^0-9]/g, "")}</span>`,
  }[kind] || "";
  return L.divIcon({
    className: `pin pin-${kind}`,
    html: `<div class="pin-body">${inner}</div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
}

/** Draws a route line into `layer`. */
export function routeLine(layer, points) {
  const coordinates = points.map((point) => [point.lat, point.lng]);
  L.polyline(coordinates, { color: "#ffffff", weight: 8, opacity: 0.9 }).addTo(layer);
  L.polyline(coordinates, { color: "#2563a8", weight: 4.5, opacity: 0.95 }).addTo(layer);
}

/** Zooms to show every point. */
export function fitTo(map, points, padding = 40) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 13));
    return;
  }
  map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), { padding: [padding, padding], maxZoom: 14 });
}

/** A Google Maps directions link to `to`, from `from` when known (else from the viewer's location). */
export function directionsUrl(to, from = null) {
  const origin = from ? `&origin=${from.lat},${from.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}${origin}`;
}

/** Asks the browser for the viewer's position. */
export function currentPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share your location"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (problem) =>
        reject(new Error(problem.code === 1 ? "Location access was blocked. Allow it in the browser to use this." : "Couldn't get your location")),
      { timeout, enableHighAccuracy: true },
    );
  });
}
