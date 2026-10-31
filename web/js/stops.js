// The kinds of places an event can have, and how each is shown.

/** [kind, label, short description] in the order they're offered. */
export const PLACE_KINDS = {
  meet: { label: "Meeting point", hint: "Where everyone gathers first", icon: "users" },
  stop: { label: "Stop on the way", hint: "Everyone stops here", icon: "pin" },
  optional: { label: "Optional stop", hint: "For whoever wants it", icon: "compass" },
  venue: { label: "Event venue", hint: "Where the event happens", icon: "mountain" },
};

/**
 * Every place of an event in itinerary order: the meeting point, then the
 * stops in order, with the venue last. Each has `kind`, `name`, `lat`, `lng`, `note`.
 */
export function itinerary(event, stops = []) {
  const meet = { kind: "meet", name: event.place_name, lat: event.lat, lng: event.lng, note: "" };
  const between = stops.filter((stop) => stop.kind !== "venue");
  const venue = stops.filter((stop) => stop.kind === "venue");
  return [meet, ...between, ...venue];
}

/** The pin label for each place: M for the meeting point, numbers for stops, V for the venue. */
export function pinLabels(places) {
  let number = 0;
  return places.map((place) => {
    if (place.kind === "meet") return "M";
    if (place.kind === "venue") return "V";
    number += 1;
    return String(number);
  });
}
