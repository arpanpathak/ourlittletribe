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
  pickup: { label: "Also meeting at", hint: "Another place people may meet from", icon: "navigation" },
  stop: { label: "Stop on the way", hint: "Everyone stops here", icon: "pin" },
  optional: { label: "Optional stop", hint: "For whoever wants it", icon: "compass" },
  venue: { label: "Event venue", hint: "Where the event happens", icon: "mountain" },
  after: { label: "After the event", hint: "Where the group goes afterwards", icon: "store" },
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

/**
 * Where a kind of place sits in an itinerary: the meeting point, then other
 * meeting points, stops on the way, the venue, and what comes after. Places
 * of one stage keep the planner's order. The server orders saved places the
 * same way (`StopKind::stage`).
 */
export function stage(kind: PlaceKind): number {
  switch (kind) {
    case "meet":
      return -1;
    case "pickup":
      return 0;
    case "stop":
    case "optional":
      return 1;
    case "venue":
      return 2;
    case "after":
      return 3;
  }
}

/** Places in itinerary order; a stable sort keeps the planner's order within each stage. */
export function inStageOrder<Item extends { kind: PlaceKind }>(places: Item[]): Item[] {
  return [...places].sort((first, second) => stage(first.kind) - stage(second.kind));
}

/** Every place of an event in order: the meeting point, then the others by stage. */
export function itinerary(event: Event, stops: Stop[]): PlanPlace[] {
  const meet: PlanPlace = { kind: "meet", ...event.meeting_point, note: "" };
  return [meet, ...inStageOrder(stops)];
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
      case "pickup":
        return "P";
      case "after":
        return "A";
      case "stop":
      case "optional":
        stopNumber += 1;
        return String(stopNumber);
    }
  });
}
