// The places an event goes, in order: the meeting point, stops, and the venue.

import type { Event, Stop, StopKind } from "./api/types.js";
import type { IconName } from "./icons.js";

/** The meeting point, or one of the stop kinds. */
export type PlaceKind = "meet" | StopKind;

/** How a kind of place is shown. */
export interface PlaceKindInfo {
  /** What it is called, such as "Stop on the way". */
  label: string;
  /** A line about it. */
  hint: string;
  /** Its icon. */
  icon: IconName;
}

export const PLACE_KINDS: Record<PlaceKind, PlaceKindInfo> = {
  meet: { label: "Meeting point", hint: "Where everyone gathers first", icon: "users" },
  stop: { label: "Stop on the way", hint: "Everyone stops here", icon: "pin" },
  optional: { label: "Optional stop", hint: "For whoever wants it", icon: "compass" },
  venue: { label: "Event venue", hint: "Where the event happens", icon: "mountain" },
};

/** One place on the plan. */
export interface PlanPlace {
  /** What it is for. */
  kind: PlaceKind;
  /** Its name. */
  name: string;
  /** Latitude. */
  lat: number;
  /** Longitude. */
  lng: number;
  /** A line from the planner. */
  note: string;
}

/** Every place of an event in order: the meeting point, the stops, then the venue. */
export function itinerary(event: Event, stops: Stop[]): PlanPlace[] {
  const meet: PlanPlace = { kind: "meet", ...event.meeting_point, note: "" };
  const between = stops.filter((stop) => stop.kind !== "venue");
  const venue = stops.filter((stop) => stop.kind === "venue");
  return [meet, ...between, ...venue];
}

/** The pin label of each place: M for the meeting point, numbers for stops, V for the venue. */
export function pinLabels(kinds: PlaceKind[]): string[] {
  let stopNumber = 0;

  return kinds.map((kind) => {
    switch (kind) {
      case "meet":
        return "M";
      case "venue":
        return "V";
      case "stop":
      case "optional":
        stopNumber += 1;
        return String(stopNumber);
    }
  });
}
