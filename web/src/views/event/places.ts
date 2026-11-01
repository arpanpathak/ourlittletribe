// The event's places on a map and in a list, and directions through them.

import type { Map as LeafletMap } from "leaflet";

import type { EventDetail } from "../../api/types.js";
import { h } from "../../dom.js";
import { icon } from "../../icons.js";
import { PLACE_KINDS, itinerary, pinLabels, type PlanPlace } from "../../itinerary.js";
import { directionsUrl, itineraryLine, itineraryUrl, placePin } from "../../map.js";

/** Directions through the meeting point, the stops everyone makes, the venue and what comes after; other meeting points and optional stops are left out. */
export function tripDirections(detail: EventDetail): string {
  const skipped = (kind: string) => kind === "optional" || kind === "pickup";
  const places = itinerary(detail.event, detail.stops).filter((place) => !skipped(place.kind));
  return itineraryUrl(places);
}

function itineraryRow(place: PlanPlace, label: string): HTMLElement {
  const directions = h("a", { class: "btn btn-ghost btn-icon btn-sm", href: directionsUrl(place), target: "_blank", rel: "noopener", title: `Directions to ${place.name}`, "aria-label": `Directions to ${place.name}` }, icon("navigation", "sm"));

  return h("li", { class: `itin-${place.kind}` },
    h("span", { class: `loc-badge loc-badge-${place.kind}` }, label),
    h("div", { class: "grow" },
      h("div", { class: "tiny muted strong itin-kind" }, PLACE_KINDS[place.kind].label),
      h("div", { class: "strong" }, place.name),
      place.note ? h("div", { class: "small text-2" }, place.note) : null),
    directions);
}

/** The places in order, each with its pin label and a directions button. */
export function itineraryList(detail: EventDetail): HTMLElement {
  const places = itinerary(detail.event, detail.stops);
  const labels = pinLabels(places.map((place) => place.kind));
  return h("ol", { class: "itinerary" }, places.map((place, index) => itineraryRow(place, labels[index] ?? "")));
}

/** Puts every place on `map`, labelled, joined by a dashed line; returns the places. */
export function drawItineraryPins(map: LeafletMap, detail: EventDetail): PlanPlace[] {
  const places = itinerary(detail.event, detail.stops);
  const labels = pinLabels(places.map((place) => place.kind));
  const layer = L.layerGroup().addTo(map);

  itineraryLine(layer, places.filter((place) => place.kind !== "pickup"));
  places.forEach((place, index) => {
    L.marker([place.lat, place.lng], { icon: placePin(place.kind, labels[index] ?? "") })
      .bindTooltip(`${PLACE_KINDS[place.kind].label}: ${place.name}`, { direction: "top", offset: [0, -30] })
      .addTo(layer);
  });
  return places;
}
