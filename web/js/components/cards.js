// Cards and rows for events and tribes, shared by every list in the app.

import { api } from "../api.js";
import { h, icon, toast, actionButton, eventCover, tribeCover, dateParts, formatWhen, formatTime, dayHeading } from "../ui.js";

function going(event) {
  return event.my_rsvp === "going" ? h("span", { class: "badge badge-accent" }, icon("check", "sm"), "Going") : null;
}

/** A card with a picture, for grids of events. */
export function eventCard(event) {
  const { month, day } = dateParts(event.starts_at);
  return h("a", { class: "event-card card", href: `#/events/${event.id}` },
    h("div", { style: "position:relative" },
      eventCover(event),
      h("div", { class: "date-chip" }, h("span", {}, month), h("b", {}, day)),
      event.my_rsvp === "going" ? h("div", { class: "card-status" }, going(event)) : null),
    h("div", { class: "event-card-body" },
      h("div", { class: "meta-line" }, h("span", { class: "strong", style: "color:var(--text-2)" }, event.tribe_name)),
      h("h3", { class: "clamp-2" }, event.title),
      h("div", { class: "meta-line" }, icon("clock"), h("span", {}, formatWhen(event.starts_at))),
      h("div", { class: "meta-line" }, icon("pin"), h("span", {}, event.place_name)),
      h("div", { class: "event-card-foot" },
        h("span", { class: "small muted" }, `${event.going_count} going`))));
}

/** A compact row, for long lists of events; `timeOnly` when the list is already grouped by day. */
export function eventRow(event, { timeOnly = false, ...attributes } = {}) {
  return h("a", { class: "event-row", href: `#/events/${event.id}`, ...attributes },
    eventCover(event),
    h("div", { class: "event-row-body" },
      h("div", { class: "event-row-when" }, timeOnly ? formatTime(event.starts_at) : `${dayHeading(event.starts_at)} · ${formatTime(event.starts_at)}`),
      h("h3", { class: "ellipsis" }, event.title),
      h("div", { class: "meta-line" }, icon("pin"), h("span", {}, event.place_name)),
      h("div", { class: "row small muted", style: "gap:10px" },
        h("span", {}, event.tribe_name),
        h("span", {}, "·"),
        h("span", {}, `${event.going_count} going`),
        going(event))));
}

/** A card for a tribe, with a join button for tribes the viewer is not in. */
export function tribeCard(tribe, onChange = null) {
  const membership = tribe.is_member
    ? h("span", { class: "badge badge-accent" }, icon("check", "sm"), tribe.is_organizer ? "Organizer" : "Member")
    : actionButton("Join", async () => {
        const joined = await api.joinTribe(tribe.id);
        toast(`You joined ${joined.name}`, "success");
        onChange?.(joined);
      }, { class: "btn btn-sm btn-primary" });
  return h("article", { class: "tribe-card card" },
    h("a", { href: `#/tribes/${tribe.id}` },
      tribeCover(tribe),
      h("div", { class: "tribe-card-body" },
        h("h3", {}, tribe.name),
        tribe.home_area ? h("div", { class: "meta-line" }, icon("pin"), h("span", {}, tribe.home_area)) : null,
        tribe.description ? h("p", { class: "small text-2 clamp-2" }, tribe.description) : null)),
    h("div", { class: "tribe-card-foot" },
      h("span", { class: "small muted" }, `${tribe.member_count} ${tribe.member_count === 1 ? "member" : "members"}`),
      membership));
}

/** A one-line link to a tribe with a small picture. */
export function tribeRow(tribe) {
  return h("a", { class: "list-row", href: `#/tribes/${tribe.id}` },
    h("div", { class: "thumb" }, tribeCover(tribe, { className: "cover-fill" })),
    h("div", { class: "grow" },
      h("div", { class: "strong ellipsis" }, tribe.name),
      h("div", { class: "small muted" }, `${tribe.member_count} ${tribe.member_count === 1 ? "member" : "members"}`)),
    icon("chevronRight", "sm"));
}
