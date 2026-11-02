// Cards and rows for events and tribes, shared by every list in the app.

import { tribes } from "../api/client.js";
import type { Event, Tribe } from "../api/types.js";
import { h } from "../dom.js";
import { count, dateParts, dayHeading, formatTime, formatWhen } from "../format.js";
import { icon } from "../icons.js";
import { markdownToText } from "../markdown.js";
import { actionButton } from "../ui/controls.js";
import { toast } from "../ui/feedback.js";
import { avatar, eventCover, tribeCover } from "../ui/pictures.js";

function goingBadge(event: Event): HTMLElement | null {
  if (event.my_rsvp !== "going") return null;
  return h("span", { class: "badge badge-accent" }, icon("check", "sm"), "Going");
}

function metaLine(iconName: "clock" | "pin", text: string): HTMLElement {
  return h("div", { class: "meta-line" }, icon(iconName), h("span", {}, text));
}

/** A card with a picture, for grids of events. */
export function eventCard(event: Event): HTMLElement {
  const { month, day } = dateParts(event.starts_at);
  const status = goingBadge(event);

  const picture = h("div", { class: "card-picture" },
    eventCover(event),
    h("div", { class: "date-chip" }, h("span", {}, month), h("b", {}, day)),
    status ? h("div", { class: "card-status" }, status) : null);

  const body = h("div", { class: "event-card-body" },
    h("div", { class: "meta-line strong" }, h("span", {}, event.tribe_name)),
    h("h3", { class: "clamp-2" }, event.title),
    metaLine("clock", formatWhen(event.starts_at)),
    metaLine("pin", event.meeting_point.name),
    h("div", { class: "event-card-foot" }, h("span", { class: "small muted" }, `${event.going_count} going`)));

  return h("a", { class: "event-card card", href: `#/events/${event.id}` }, picture, body);
}

/** Optional parts of an event row. */
export interface EventRowOptions {
  /** Shows only the time, for lists already grouped by day. */
  timeOnly?: boolean;
  /** Highlights the row, such as when its pin is hovered. */
  highlight?: boolean;
}

/** A compact row, for long lists of events. */
export function eventRow(event: Event, options: EventRowOptions = {}): HTMLAnchorElement {
  const when = options.timeOnly ? formatTime(event.starts_at) : `${dayHeading(event.starts_at)} · ${formatTime(event.starts_at)}`;
  const details = h("div", { class: "event-row-meta small muted" }, h("span", { class: "ellipsis" }, event.tribe_name), h("span", {}, "·"), h("span", { class: "nowrap" }, `${event.going_count} going`), goingBadge(event));

  const body = h("div", { class: "event-row-body" },
    h("div", { class: "event-row-when" }, when),
    h("h3", { class: "ellipsis" }, event.title),
    metaLine("pin", event.meeting_point.name),
    details);

  return h("a", { class: options.highlight ? "event-row highlight" : "event-row", href: `#/events/${event.id}` }, eventCover(event), body);
}

function membershipBadge(tribe: Tribe, onJoined: ((tribe: Tribe) => void) | null): HTMLElement {
  if (tribe.is_member) {
    return h("span", { class: "badge badge-accent" }, icon("check", "sm"), tribe.is_organizer ? "Organizer" : "Member");
  }

  const join = async () => {
    const joined = await tribes.join(tribe.id);
    toast(`You joined ${joined.name}`, "success");
    onJoined?.(joined);
  };
  return actionButton("Join", join, { class: "btn btn-sm btn-primary" });
}

/** A card for a tribe, with a join button when the viewer is not in it. */
export function tribeCard(tribe: Tribe, onJoined: ((tribe: Tribe) => void) | null = null): HTMLElement {
  const description = tribe.description ? h("p", { class: "small text-2 clamp-2" }, markdownToText(tribe.description)) : null;
  const area = tribe.home_area ? metaLine("pin", tribe.home_area) : null;

  const link = h("a", { href: `#/tribes/${tribe.id}` }, tribeCover(tribe), h("div", { class: "tribe-card-body" }, h("h3", {}, tribe.name), area, description));
  const foot = h("div", { class: "tribe-card-foot" }, h("span", { class: "small muted" }, count(tribe.member_count, "member")), membershipBadge(tribe, onJoined));

  return h("article", { class: "tribe-card card" }, link, foot);
}

/** A one-line link to a tribe with a small picture. */
export function tribeRow(tribe: Tribe): HTMLElement {
  return h("a", { class: "list-row", href: `#/tribes/${tribe.id}` },
    h("div", { class: "thumb" }, tribeCover(tribe)),
    h("div", { class: "grow" }, h("div", { class: "strong ellipsis" }, tribe.name), h("div", { class: "small muted" }, count(tribe.member_count, "member"))),
    icon("chevronRight", "sm"));
}

/** A person to show in a grid of people. */
export interface PersonTile {
  /** Their account id. */
  id: string;
  /** Their name. */
  name: string;
  /** Their profile picture's id. */
  avatar: string | null;
  /** A line under the name, such as "Organizer". */
  line: string;
}

/** A link to someone's profile, with their picture and a line about them. */
export function personTile(person: PersonTile, size = 40): HTMLElement {
  const line = person.line ? h("div", { class: "tiny muted ellipsis" }, person.line) : null;
  return h("a", { class: "person", href: `#/people/${person.id}` },
    avatar({ name: person.name, avatar: person.avatar }, size),
    h("div", { class: "person-text" }, h("div", { class: "strong ellipsis" }, person.name), line));
}
