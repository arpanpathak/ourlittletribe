// Home: upcoming events, your tribes, and what your tribes have been doing.

import { api } from "../api.js";
import { skyline, squatch, emblem } from "../art.js";
import { h, mount, relativeTime, avatar } from "../ui.js";
import { session } from "../app.js";
import { eventCard } from "./tribes.js";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function skyForNow() {
  const hour = new Date().getHours();
  if (hour >= 20 || hour < 5) return "night";
  if (hour >= 16) return "dusk";
  return "dawn";
}

/** Draws the home page. */
export async function renderHome(view) {
  const feed = await api.feed();
  const sky = skyForNow();
  const firstName = session.user.name.split(" ")[0];
  const myTribeIds = new Set(feed.my_tribes.map((tribe) => tribe.id));
  const mine = feed.upcoming.filter((event) => myTribeIds.has(event.tribe_id));
  const elsewhere = feed.upcoming.filter((event) => !myTribeIds.has(event.tribe_id));

  mount(
    view,
    h("section", { class: `page-hero sky-${sky}` },
      h("div", { class: "page-hero-art", html: skyline(sky, { stars: sky === "night" }) }),
      h("div", { class: "page-hero-inner" },
        h("div", {},
          h("p", { class: "eyebrow" }, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })),
          h("h1", {}, `${greeting()}, ${firstName}`),
          h("p", { class: "lead" }, mine.length ? `${mine.length} upcoming with your tribes.` : "Nothing planned yet. The mountains are out."),
        ),
        h("div", { class: "hero-squatch", html: squatch("wave", 120) }),
      ),
    ),
    h("div", { class: "home-grid" },
      h("div", { class: "stack-lg" },
        h("section", {},
          h("div", { class: "section-head" },
            h("h2", { class: "section-title" }, "Coming up"),
            feed.my_tribes.length ? h("a", { class: "button ghost small", href: `#/events/new?tribe=${feed.my_tribes[0].id}` }, "+ Plan something") : null),
          mine.length
            ? h("div", { class: "list" }, mine.map(eventCard))
            : h("div", { class: "empty card" },
                h("div", { html: squatch("map", 100) }),
                h("p", {}, feed.my_tribes.length ? "No plans yet. Pick a trail and plan one." : "Join a tribe to see its plans."),
                h("a", { class: "button primary", href: feed.my_tribes.length ? `#/events/new?tribe=${feed.my_tribes[0].id}` : "#/tribes" },
                  feed.my_tribes.length ? "Plan an outing" : "Find a tribe")),
        ),
        elsewhere.length
          ? h("section", {}, h("h2", { class: "section-title" }, "Open to join"), h("div", { class: "list" }, elsewhere.slice(0, 8).map(eventCard)))
          : null,
      ),
      h("aside", { class: "stack-lg" },
        h("section", { class: "card" },
          h("h3", {}, "Your tribes"),
          feed.my_tribes.length
            ? h("ul", { class: "plain-list" }, feed.my_tribes.map((tribe) =>
                h("li", {}, h("a", { class: "row-link", href: `#/tribes/${tribe.id}` },
                  h("span", { html: emblem(tribe.emblem, 28) }), h("span", {}, tribe.name),
                  h("span", { class: "muted small push" }, String(tribe.member_count))))))
            : h("p", { class: "muted" }, "You haven't joined any yet."),
          h("a", { class: "button ghost wide", href: "#/tribes" }, "Browse tribes"),
        ),
        h("section", { class: "card" },
          h("h3", {}, "Around the campfire"),
          feed.activity.length
            ? h("ul", { class: "activity" }, feed.activity.map((entry) =>
                h("li", {},
                  avatar(entry.user_name, 28),
                  h("div", {},
                    h("a", { href: entry.target_type === "event" ? `#/events/${entry.target_id}` : `#/tribes/${entry.target_id}` }, entry.summary),
                    h("p", { class: "muted small" }, relativeTime(entry.created_at))))))
            : h("p", { class: "muted" }, "Quiet so far. Things your tribes do show up here."),
        ),
      ),
    ),
  );
}
