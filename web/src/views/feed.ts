// The feed: your next outing, what's coming up in your tribes, and recent activity.

import { discovery } from "../api/client.js";
import type { ActivityEntry, Event, Feed, Tribe } from "../api/types.js";
import { heroScene } from "../art.js";
import { eventCard, tribeRow } from "../components/cards.js";
import { h, mount } from "../dom.js";
import { count, formatLongDay, formatTime, relativeTime } from "../format.js";
import { icon } from "../icons.js";
import { me } from "../session.js";
import { emptyState } from "../ui/feedback.js";
import { avatar, eventCover } from "../ui/pictures.js";

/** Most activity lines to show. */
const MOST_ACTIVITY = 12;

/** One step of the getting-started row. */
interface Step {
  /** Whether it is done already. */
  done: boolean;
  /** The headline. */
  title: string;
  /** A sentence about it. */
  text: string;
  /** A button to do it, if there is one. */
  action: HTMLElement | null;
}

/** The feed's events, sorted into the places they are shown. */
interface Sorted {
  /** The soonest event the viewer is going to. */
  next: Event | null;
  /** Everything the viewer is going to. */
  going: Event[];
  /** The rest from the viewer's tribes. */
  fromMyTribes: Event[];
  /** Events from tribes the viewer is not in. */
  elsewhere: Event[];
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function sort(feed: Feed): Sorted {
  const myTribeIds = new Set(feed.my_tribes.map((tribe) => tribe.id));
  const going = feed.upcoming.filter((event) => event.my_rsvp === "going");
  const next = going[0] ?? null;

  return {
    next,
    going,
    fromMyTribes: feed.upcoming.filter((event) => myTribeIds.has(event.tribe_id) && event !== next),
    elsewhere: feed.upcoming.filter((event) => !myTribeIds.has(event.tribe_id)),
  };
}

/* ── The banner ───────────────────────────────────── */

function banner(going: Event[]): HTMLElement {
  const outings = count(going.length, "upcoming outing");
  const line = going.length ? `You're going to ${outings}.` : "Here's what's happening in your tribes.";
  const firstName = me().name.split(" ")[0] ?? "";

  const actions = h("div", { class: "row" },
    h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "Plan an outing"),
    h("a", { class: "btn", href: "#/events" }, icon("calendar"), "Browse events"));

  return h("section", { class: "banner" },
    h("div", { class: "banner-art", html: heroScene() }),
    h("div", { class: "banner-text" }, h("h1", {}, `${greeting()}, ${firstName}`), h("p", {}, line), actions));
}

function nextUp(event: Event): HTMLElement {
  const facts = h("div", { class: "facts next-up-facts" },
    h("span", {}, icon("calendar"), `${formatLongDay(event.starts_at)} at ${formatTime(event.starts_at)}`),
    h("span", {}, icon("pin"), event.meeting_point.name),
    h("span", {}, icon("users"), `${event.going_count} going · ${event.tribe_name}`));

  const body = h("div", { class: "next-up-body" },
    h("div", { class: "countdown" }, `Your next outing · ${relativeTime(event.starts_at)}`),
    h("h2", {}, event.title),
    facts,
    h("div", { class: "row" }, h("span", { class: "btn btn-primary" }, "Open event", icon("arrowRight"))));

  return h("a", { class: "next-up card", href: `#/events/${event.id}` }, eventCover(event, { size: "large" }), body);
}

/* ── Getting started ──────────────────────────────── */

function stepCard(step: Step, index: number): HTMLElement {
  return h("div", { class: step.done ? "card step done" : "card step" },
    h("span", { class: "step-n" }, step.done ? icon("check", "sm") : String(index + 1)),
    h("h3", {}, step.title),
    h("p", { class: "small text-2" }, step.text),
    step.action ? h("div", { class: "step-action" }, step.action) : null);
}

function onboarding(hasTribe: boolean): HTMLElement {
  const steps: Step[] = [
    { done: hasTribe, title: "Join or start a tribe", text: "A tribe is your group: friends, a running club, a book club.", action: h("a", { class: "btn btn-sm", href: "#/tribes" }, "Browse tribes") },
    { done: false, title: "Plan an outing", text: "Pick a place on the map and a time. Everyone in the tribe sees it.", action: h("a", { class: "btn btn-sm", href: "#/events/new" }, "New event") },
    { done: false, title: "Get ready together", text: "Build the packing list, see who has what, and share photos after.", action: null },
  ];

  return h("section", { class: "section" }, h("h2", {}, "Get started"), h("div", { class: "onboarding" }, steps.map(stepCard)));
}

/* ── The main column ──────────────────────────────── */

function sectionHead(title: string, linkText: string, href: string): HTMLElement {
  return h("div", { class: "section-head" }, h("h2", {}, title), h("a", { href }, linkText));
}

function nothingPlanned(inATribe: boolean): HTMLElement {
  const empty = inATribe
    ? emptyState("calendar", "Nothing planned yet", "Be the one who gets everyone outside.", h("a", { class: "btn btn-primary", href: "#/events/new" }, icon("plus"), "Plan an outing"))
    : emptyState("calendar", "Nothing planned yet", "Join a tribe to see what it's planning.", h("a", { class: "btn btn-primary", href: "#/tribes" }, "Browse tribes"));
  return h("div", { class: "card" }, empty);
}

function mainColumn(sorted: Sorted, inATribe: boolean): HTMLElement {
  const comingUp = sorted.fromMyTribes.length ? h("div", { class: "grid-cards" }, sorted.fromMyTribes.slice(0, 6).map(eventCard)) : nothingPlanned(inATribe);

  const openToJoin = sorted.elsewhere.length
    ? h("section", { class: "section" }, sectionHead("Open to join", "Explore", "#/events"), h("div", { class: "grid-cards" }, sorted.elsewhere.slice(0, 3).map(eventCard)))
    : null;

  return h("div", { class: "stack-lg" },
    sorted.next ? nextUp(sorted.next) : null,
    h("section", { class: "section" }, sectionHead("Coming up in your tribes", "See all events", "#/events"), comingUp),
    openToJoin);
}

/* ── The side column ──────────────────────────────── */

function activityLine(entry: ActivityEntry): HTMLElement {
  const href = `#/${entry.about.type === "event" ? "events" : "tribes"}/${entry.about.id}`;
  return h("li", {},
    avatar({ name: entry.user_name, avatar: entry.user_avatar }, 28),
    h("div", { class: "grow" }, h("a", { href }, entry.summary), h("div", { class: "tiny muted" }, relativeTime(entry.created_at))));
}

function activityList(entries: ActivityEntry[]): HTMLElement {
  if (!entries.length) return h("p", { class: "small muted" }, "When people in your tribes plan, join or share photos, it shows up here.");
  return h("ul", { class: "activity" }, entries.slice(0, MOST_ACTIVITY).map(activityLine));
}

function tribesCard(myTribes: Tribe[]): HTMLElement {
  const list = myTribes.length ? myTribes.map(tribeRow) : h("p", { class: "small muted card-note" }, "You haven't joined a tribe yet.");

  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h3", {}, "Your tribes"), h("a", { class: "small", href: "#/tribes" }, "Browse")),
    h("div", { class: "card-list" }, list),
    h("div", { class: "card-foot" }, h("a", { class: "btn btn-sm btn-block", href: "#/tribes/new" }, icon("plus", "sm"), "Start a tribe")));
}

function sideColumn(feed: Feed): HTMLElement {
  const activity = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h3", {}, "Recent activity")),
    h("div", { class: "card-body card-body-tight" }, activityList(feed.activity)));

  return h("aside", { class: "sticky-col" }, tribesCard(feed.my_tribes), activity);
}

/** Draws the feed. */
export async function renderFeed(view: HTMLElement): Promise<void> {
  const feed = await discovery.feed();
  const sorted = sort(feed);
  const inATribe = feed.my_tribes.length > 0;
  const showOnboarding = !inATribe || !feed.upcoming.length;

  mount(view,
    banner(sorted.going),
    showOnboarding ? onboarding(inATribe) : null,
    h("div", { class: "split" }, mainColumn(sorted, inATribe), sideColumn(feed)));
}
