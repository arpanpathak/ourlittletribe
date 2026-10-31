// Leaflet maps with a topo base layer, PNW-styled pins and route lines.
// Leaflet is loaded as a classic script and is available as the global `L`.

const LAYERS = {
  Topo: () =>
    L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | style © <a href="https://opentopomap.org">OpenTopoMap</a>',
    }),
  Streets: () =>
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
  Night: () =>
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "tiles-night",
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
};

/** The Puget Sound, used before anything else is known. */
export const PUGET_SOUND = { lat: 47.6062, lng: -122.3321 };

/** Makes a map inside `element`, with a layer switcher. */
export function createMap(element, center = PUGET_SOUND, zoom = 10) {
  const map = L.map(element, { zoomControl: true, scrollWheelZoom: true }).setView([center.lat, center.lng], zoom);
  const layers = {};
  for (const [name, build] of Object.entries(LAYERS)) layers[name] = build();
  layers.Topo.addTo(map);
  L.control.layers(layers, {}, { position: "topright" }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

const PIN_ART = {
  meet: `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 19 L10 8 L13 13 L15 10 L21 19 Z" fill="#fff"/></svg>`,
  start: `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="5" fill="#fff"/></svg>`,
};

/** A pin icon: `meet` for the meeting point, `start` for a starting point, `store` with a number. */
export function pin(kind, label = "") {
  const inner = kind === "store" ? `<span>${String(label).replace(/[^0-9]/g, "")}</span>` : PIN_ART[kind] || "";
  return L.divIcon({
    className: `map-pin map-pin-${kind}`,
    html: `<div class="map-pin-body">${inner}</div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -36],
  });
}

/** Draws a route as a glowing trail line and returns the layer. */
export function routeLine(map, points) {
  const coordinates = points.map((point) => [point.lat, point.lng]);
  const group = L.layerGroup([
    L.polyline(coordinates, { color: "#ffffff", weight: 9, opacity: 0.85 }),
    L.polyline(coordinates, { color: "#e07a5f", weight: 5, opacity: 0.95, dashArray: "1 10", lineCap: "round" }),
    L.polyline(coordinates, { color: "#2f5a45", weight: 4, opacity: 0.9 }),
  ]);
  group.addTo(map);
  return group;
}

/** Zooms to show every point given. */
export function fitTo(map, points, padding = 40) {
  if (!points.length) return;
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 13);
    return;
  }
  map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), { padding: [padding, padding] });
}

/** A link that opens driving directions from `from` to `to` on openstreetmap.org. */
export function directionsUrl(from, to) {
  const start = from ? `${from.lat},${from.lng}` : "";
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${start};${to.lat},${to.lng}`;
}
