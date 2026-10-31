// The feed: your next outing, what's coming up in your tribes, and recent activity.

import { api } from "../api.js";
import { h, mount, icon, avatar, emptyState, relativeTime, formatLongDay, formatTime, eventCover } from "../ui.js";
import { session } from "../app.js";
import { eventCard, tribeRow } from "../components/cards.js";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function nextUp(event) {
  return h("a", { class: "next-up card", href: `#/events/${event.id}` },
    eventCover(event, { small: false }),
    h("div", { class: "next-up-body" },
      h("div", { class: "countdown" }, `Your next outing · ${relativeTime(event.starts_at)}`),
      h("h2", {}, event.title),
      h("div", { class: "facts", style: "flex-direction:column;gap:6px" },
        h("span", {}, icon("calendar"), `${formatLongDay(event.starts_at)} at ${formatTime(event.starts_at)}`),
        h("span", {}, icon("pin"), event.place_name),
        h("span", {}, icon("users"), `${event.going_count} going · ${event.tribe_name}`)),
      h("div", { class: "row", style: "margin-top:6px" },
        h("span", { class: "btn btn-primary" }, "Open event", icon("arrowRight")))));
}

function onboarding(hasTribe) {
  const steps = [
    [hasTribe, "Join or start a tribe", "A tribe is your group: friends, a running club, a book club.", h("a", { class: "btn btn-sm", href: "#/tribes" }, "Browse tribes")],
    [false, "Plan an outing", "Pick a place on the map and a time. Everyone in the tribe sees it.", h("a", { class: "btn btn-sm", href: "#/events/new" }, "New event")],
    [false, "Get ready together", "Build the packing list, see who has what, and share photos after.", null],
  ];
  return h("section", { class: "section" },
    h("h2", {}, "Get started"),
    h("div", { class: "onboarding" }, steps.map(([done, title, text, action], index) =>
      h("div", { class: `card step${done ? " done" : ""}` },
        h("span", { class: "step-n" }, done ? icon("check", "sm") : String(index + 1)),
        h("h3", {}, title),
        h("p", { class: "small text-2" }, text),
        action ? h("div", { style: "margin-top:auto;padding-top:6px" }, action) : null))));
}

function activityList(entries) {
  if (!entries.length) return h("p", { class: "small muted" }, "When people in your tribes plan, join or share photos, it shows up here.");
  return h("ul", { class: "activity" }, entries.slice(0, 12).map((entry) =>
    h("li", {},
      avatar(entry.user_name, 28),
      h("div", { class: "grow" },
        h("a", { href: entry.target_type === "event" ? `#/events/${entry.target_id}` : `#/tribes/${entry.target_id}` }, entry.summary),
        h("div", { class: "tiny muted" }, relativeTime(entry.created_at))))));
}

/** Draws the feed. */
export async function renderFeed(view) {
  const feed = await api.feed();
  const firstName = session.user.name.split(" ")[0];
  const myTribeIds = new Set(feed.my_tribes.map((tribe) => tribe.id));
  const next = feed.upcoming.find((event) => event.my_rsvp === "going");
  const fromMyTribes = feed.upcoming.filter((event) => myTribeIds.has(event.tribe_id) && event !== next);
  const elsewhere = feed.upcoming.filter((event) => !myTribeIds.has(event.tribe_id));

  mount(view,
    h("div", { class: "page-head" },
      h("div", {},
        h("h1", {}, `${greeting()}, ${firstName}`),
        h("p", {}, feed.upcoming.some((event) => event.my_rsvp === "going")
          ? `You're going to ${feed.upcoming.filter((event) => event.my_rsvp === "going").length} upcoming ${feed.upcoming.filter((event) => event.my_rsvp === "going").length === 1 ? "outing" : "outings"}.`
          : "Here's what's happening in your tribes.")),
      h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "New event")),
    !feed.my_tribes.length || !feed.upcoming.length ? onboarding(feed.my_tribes.length > 0) : null,
    h("div", { class: "split" },
      h("div", { class: "stack-lg" },
        next ? nextUp(next) : null,
        h("section", { class: "section" },
          h("div", { class: "section-head" }, h("h2", {}, "Coming up in your tribes"), h("a", { href: "#/events" }, "See all events")),
          fromMyTribes.length
            ? h("div", { class: "grid-cards" }, fromMyTribes.slice(0, 6).map(eventCard))
            : h("div", { class: "card" }, emptyState("calendar", "Nothing planned yet",
                feed.my_tribes.length ? "Be the one who gets everyone outside." : "Join a tribe to see what it's planning.",
                feed.my_tribes.length
                  ? h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "Plan an outing")
                  : h("a", { class: "btn btn-primary", href: "#/tribes" }, "Browse tribes")))),
        elsewhere.length
          ? h("section", { class: "section" },
              h("div", { class: "section-head" }, h("h2", {}, "Open to join"), h("a", { href: "#/events" }, "Explore")),
              h("div", { class: "grid-cards" }, elsewhere.slice(0, 3).map(eventCard)))
          : null),
      h("aside", { class: "sticky-col" },
        h("section", { class: "card" },
          h("div", { class: "card-head" }, h("h3", {}, "Your tribes"), h("a", { class: "small", href: "#/tribes" }, "Browse")),
          h("div", { style: "padding:8px" },
            feed.my_tribes.length
              ? feed.my_tribes.map(tribeRow)
              : h("p", { class: "small muted", style: "padding:8px 12px" }, "You haven't joined a tribe yet.")),
          h("div", { class: "card-foot" }, h("a", { class: "btn btn-sm btn-block", href: "#/tribes/new" }, icon("plus", "sm"), "Start a tribe"))),
        h("section", { class: "card" },
          h("div", { class: "card-head" }, h("h3", {}, "Recent activity")),
          h("div", { class: "card-body", style: "padding-top:8px;padding-bottom:8px" }, activityList(feed.activity))))));
}
