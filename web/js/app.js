// The app shell: who is signed in, the header and tab bar, and the hash router.

import { api } from "./api.js";
import { h, mount, icon, iconMarkup, avatar, dropdown, menuItem, loadingPage, emptyState, toast } from "./ui.js";
import { renderAuth } from "./views/auth.js";
import { renderFeed } from "./views/feed.js";
import { renderExplore } from "./views/explore.js";
import { renderEvent } from "./views/event.js";
import { renderEventForm } from "./views/event_form.js";
import { renderTribes } from "./views/tribes.js";
import { renderTribe } from "./views/tribe.js";
import { renderTribeForm } from "./views/tribe_form.js";
import { renderProfile } from "./views/profile.js";
import { renderSearch } from "./views/search.js";

const view = document.getElementById("view");

/** The signed-in user, for every view to read. */
export const session = { user: null };

/** Moves to a route such as `/events/abc`. */
export function go(path) {
  window.location.hash = `#${path}`;
}

/** Replaces the current route without adding a history entry, such as when switching tabs. */
export function replaceRoute(path) {
  history.replaceState(null, "", `#${path}`);
}

const ROUTES = [
  [/^\/$/, () => renderFeed(view)],
  [/^\/events$/, (_unused, query) => renderExplore(view, query)],
  [/^\/events\/new$/, (_unused, query) => renderEventForm(view, null, query)],
  [/^\/events\/([^/]+)\/edit$/, (eventId) => renderEventForm(view, eventId)],
  [/^\/events\/([^/]+)$/, (eventId, query) => renderEvent(view, eventId, query.get("tab"))],
  [/^\/tribes$/, () => renderTribes(view)],
  [/^\/tribes\/new$/, () => renderTribeForm(view, null)],
  [/^\/tribes\/([^/]+)\/edit$/, (tribeId) => renderTribeForm(view, tribeId)],
  [/^\/tribes\/([^/]+)$/, (tribeId, query) => renderTribe(view, tribeId, query.get("tab"))],
  [/^\/people\/([^/]+)$/, (userId) => renderProfile(view, userId)],
  [/^\/search$/, (_unused, query) => renderSearch(view, query.get("q") || "")],
];

const NAV = [
  ["/", "Feed", "home"],
  ["/events", "Events", "calendar"],
  ["/tribes", "Tribes", "users"],
];

function currentPath() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, queryText] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(queryText || "") };
}

function isActive(target, path) {
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

function themeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  return h("button", {
    type: "button",
    class: "btn btn-ghost btn-icon",
    title: dark ? "Switch to light mode" : "Switch to dark mode",
    "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    onclick: () => {
      window.oltSetTheme(dark ? "light" : "dark");
      renderHeader();
    },
    html: iconMarkup(dark ? "sun" : "moon"),
  });
}

async function signOut() {
  try {
    await api.logout();
  } finally {
    session.user = null;
    go("/");
    route();
  }
}

function renderHeader() {
  const { path, query } = currentPath();
  const header = document.getElementById("header");
  const tabbar = document.getElementById("tabbar");
  const logo = h("a", { class: "logo", href: "#/" }, h("span", { class: "logo-mark", html: iconMarkup("logoPeak") }), h("span", {}, "OurLittleTribe"));

  if (!session.user) {
    mount(header, logo, h("div", { class: "header-actions", style: "margin-left:auto" }, themeButton()));
    tabbar.hidden = true;
    return;
  }

  const searchInput = h("input", { type: "search", placeholder: "Search events, tribes, people, places", "aria-label": "Search", value: path === "/search" ? query.get("q") || "" : "" });
  const searchForm = h("form", { class: "header-search", role: "search" }, icon("search"), searchInput);
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = searchInput.value.trim();
    if (text) go(`/search?q=${encodeURIComponent(text)}`);
  });

  const create = dropdown(
    h("button", { type: "button", class: "btn btn-primary create-menu" }, icon("plus"), "Create"),
    () => [
      menuItem("calendar", "New event", null, { href: "#/events/new" }),
      menuItem("users", "New tribe", null, { href: "#/tribes/new" }),
    ]);

  const me = session.user;
  const account = dropdown(
    h("button", { type: "button", class: "btn btn-ghost btn-icon", "aria-label": "Your account", style: "width:auto;padding:0 4px" }, avatar(me.name, 32)),
    () => [
      h("div", { class: "menu-label" }, h("div", { class: "strong", style: "color:var(--text)" }, me.name), me.email),
      "-",
      menuItem("user", "Your profile", null, { href: `#/people/${me.id}` }),
      menuItem("calendar", "Your events", null, { href: "#/events?show=going" }),
      "-",
      menuItem("logout", "Sign out", signOut, { class: "menu-danger" }),
    ]);

  mount(header,
    logo,
    h("nav", { class: "main-nav", "aria-label": "Main" },
      NAV.map(([target, label, iconName]) =>
        h("a", { href: `#${target}`, class: isActive(target, path) ? "active" : null, "aria-current": isActive(target, path) ? "page" : null }, icon(iconName), label))),
    searchForm,
    h("div", { class: "header-actions" },
      h("a", { href: "#/search", class: "btn btn-ghost btn-icon mobile-only", "aria-label": "Search" }, icon("search")),
      create,
      themeButton(),
      account));

  tabbar.hidden = false;
  const tab = (target, label, iconName) =>
    h("a", { href: `#${target}`, class: isActive(target, path) ? "active" : null }, icon(iconName), label);
  mount(tabbar,
    tab("/", "Feed", "home"),
    tab("/events", "Events", "calendar"),
    dropdown(h("button", { type: "button", class: "tab-create", "aria-label": "Create" }, icon("plus")), () => [
      menuItem("calendar", "New event", null, { href: "#/events/new" }),
      menuItem("users", "New tribe", null, { href: "#/tribes/new" }),
    ]),
    tab("/tribes", "Tribes", "users"),
    tab(`/people/${me.id}`, "Profile", "user"));
}

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  renderHeader();
  view.classList.remove("narrow");
  view.classList.add("page");
  if (!session.user) {
    renderAuth(view, (user) => {
      session.user = user;
      route();
    });
    return;
  }
  const { path, query } = currentPath();
  for (const [pattern, render] of ROUTES) {
    const match = path.match(pattern);
    if (!match) continue;
    window.scrollTo(0, 0);
    mount(view, loadingPage());
    try {
      await render(match[1] ? decodeURIComponent(match[1]) : undefined, query);
    } catch (error) {
      if (token !== routeToken) return;
      const missing = error.status === 404;
      mount(view, emptyState(missing ? "compass" : "alert",
        missing ? "Not found" : "That didn't load",
        missing ? "It may have been deleted, or the link is wrong." : error.message,
        h("a", { class: "btn", href: "#/" }, "Back to your feed")));
    }
    return;
  }
  go("/");
}

window.addEventListener("hashchange", route);
window.addEventListener("signed-out", () => {
  if (session.user) {
    session.user = null;
    toast("Your session ended. Please sign in again.");
    route();
  }
});

/** Redraws the header, e.g. after the user's name changes. */
export function refreshHeader() {
  renderHeader();
}

try {
  session.user = await api.me();
} catch {
  session.user = null;
}
route();
