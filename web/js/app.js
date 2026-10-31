// The app shell: who is signed in, the header and tab bar, and the hash router.

import { api } from "./api.js";
import { h, mount, icon, iconMarkup, avatar, dropdown, menuItem, segmented, tribeCover, loadingPage, emptyState, toast } from "./ui.js";
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
  ["/", "Home", "home"],
  ["/events", "Events", "calendar"],
  ["/tribes", "Tribes", "users"],
  ["/search", "Search", "search"],
];

/** Top-level pages; anything deeper gets a back button. */
const TOP_LEVEL = new Set(["/", "/events", "/tribes", "/search"]);

/** The viewer's tribes, for the sidebar; refreshed as they move around. */
let myTribes = [];
let tribesFetchedAt = 0;
/** Pages visited in this visit, so Back can stay inside the app. */
const trail = [];

function remember() {
  const here = window.location.hash || "#/";
  if (trail.length > 1 && trail[trail.length - 2] === here) trail.pop();
  else if (trail[trail.length - 1] !== here) trail.push(here);
}

function currentPath() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, queryText] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(queryText || "") };
}

function isActive(target, path) {
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

/** Where Back goes when there is no earlier page in this visit. */
function parentOf(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "people") return "/";
  if (parts.length >= 3) return `/${parts[0]}/${parts[1]}`;
  return `/${parts[0] || ""}`;
}

/** Light, dark, or following the device: three labelled buttons. */
function themeSwitch() {
  const choice = window.oltThemeChoice() || "auto";
  return h("div", { class: "theme-switch" },
    h("span", { class: "theme-label" }, "Appearance"),
    segmented([["light", "Light", "sun"], ["dark", "Dark", "moon"], ["auto", "Auto", "monitor"]], choice, (value) => {
      window.oltSetTheme(value === "auto" ? null : value);
    }, "Appearance"));
}

/** A one-click toggle for the top bar on small screens. */
function themeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  return h("button", {
    type: "button",
    class: "btn btn-ghost btn-icon",
    title: dark ? "Switch to light mode" : "Switch to dark mode",
    "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
    onclick: () => window.oltSetTheme(dark ? "light" : "dark"),
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

function logo() {
  return h("a", { class: "logo", href: "#/" }, h("span", { class: "logo-mark", html: iconMarkup("logoPeak") }), h("span", {}, "OurLittleTribe"));
}

function createMenu(trigger) {
  return dropdown(trigger, () => [
    menuItem("calendar", "New event", null, { href: "#/events/new" }),
    menuItem("users", "New tribe", null, { href: "#/tribes/new" }),
  ]);
}

function closeDrawer() {
  document.body.classList.remove("drawer-open");
  document.getElementById("scrim")?.remove();
}

function openDrawer() {
  document.body.classList.add("drawer-open");
  const scrim = h("div", { class: "scrim", id: "scrim", onclick: closeDrawer });
  document.body.appendChild(scrim);
}

function renderSidebar(path) {
  const sidebar = document.getElementById("sidebar");
  const me = session.user;
  if (!me) {
    sidebar.hidden = true;
    document.body.classList.remove("has-sidebar");
    return;
  }
  sidebar.hidden = false;
  document.body.classList.add("has-sidebar");
  const account = dropdown(
    h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": "Account menu" }, icon("more")),
    () => [
      menuItem("user", "Your profile", null, { href: `#/people/${me.id}` }),
      menuItem("calendar", "Events you're going to", null, { href: "#/events?show=going" }),
      "-",
      menuItem("logout", "Sign out", signOut, { class: "menu-danger" }),
    ]);
  mount(sidebar,
    logo(),
    h("div", { class: "side-create" }, createMenu(h("button", { type: "button", class: "btn btn-primary" }, icon("plus"), "Create", icon("chevronDown", "sm")))),
    h("nav", { class: "side-nav", "aria-label": "Main" },
      NAV.map(([target, label, iconName]) =>
        h("a", { href: `#${target}`, class: isActive(target, path) ? "active" : null, "aria-current": isActive(target, path) ? "page" : null }, icon(iconName), label)),
      h("a", { href: `#/people/${me.id}`, class: path === `/people/${me.id}` ? "active" : null }, icon("user"), "Profile")),
    h("div", { class: "side-heading" }, h("span", {}, "Your tribes"), h("a", { href: "#/tribes/new" }, "+ New")),
    myTribes.length
      ? h("div", { class: "side-nav" }, myTribes.slice(0, 8).map((tribe) =>
          h("a", { class: `side-link${path.startsWith(`/tribes/${tribe.id}`) ? " active" : ""}`, href: `#/tribes/${tribe.id}` },
            h("span", { class: "thumb" }, tribeCover(tribe)), h("span", { class: "ellipsis" }, tribe.name))))
      : h("p", { class: "side-empty" }, "None yet. ", h("a", { href: "#/tribes" }, "Find a tribe")),
    h("div", { class: "side-foot" },
      themeSwitch(),
      h("div", { class: "account-row" },
        h("a", { href: `#/people/${me.id}`, "aria-label": "Your profile" }, avatar(me.name, 34, me.avatar)),
        h("div", { class: "grow" }, h("div", { class: "strong small ellipsis" }, me.name), h("div", { class: "tiny muted ellipsis" }, me.email)),
        account)));
  sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeDrawer));
}

async function refreshTribes(force = false) {
  if (!session.user || (!force && Date.now() - tribesFetchedAt < 15000)) return;
  tribesFetchedAt = Date.now();
  try {
    myTribes = (await api.tribes()).filter((tribe) => tribe.is_member);
    renderSidebar(currentPath().path);
  } catch {
    /* the sidebar keeps its last list */
  }
}

function renderHeader() {
  const { path, query } = currentPath();
  const header = document.getElementById("header");
  const tabbar = document.getElementById("tabbar");
  renderSidebar(path);

  if (!session.user) {
    mount(header, logo(), h("div", { class: "header-actions", style: "margin-left:auto" }, themeButton()));
    tabbar.hidden = true;
    return;
  }

  const searchInput = h("input", { type: "search", placeholder: "Search events, tribes, people, places", "aria-label": "Search", value: path === "/search" ? query.get("q") || "" : "" });
  const searchForm = h("form", { class: "header-search", role: "search" }, icon("search"), searchInput, h("kbd", {}, "/"));
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = searchInput.value.trim();
    if (text) go(`/search?q=${encodeURIComponent(text)}`);
  });

  const me = session.user;
  const nested = !TOP_LEVEL.has(path);
  const back = nested
    ? h("button", {
        type: "button",
        class: "btn btn-ghost btn-sm back-btn",
        onclick: () => (trail.length > 1 ? history.back() : go(parentOf(path))),
      }, icon("arrowLeft", "sm"), "Back")
    : null;

  mount(header,
    h("button", { type: "button", class: "btn btn-ghost btn-icon desktop-hidden", "aria-label": "Open menu", onclick: openDrawer }, icon("menu")),
    nested ? null : h("span", { class: "header-logo" }, logo()),
    back,
    searchForm,
    h("div", { class: "header-actions" },
      h("a", { href: "#/search", class: "btn btn-ghost btn-icon mobile-only", "aria-label": "Search" }, icon("search")),
      h("span", { class: "desktop-hidden" }, themeButton()),
      h("a", { class: "desktop-hidden", href: `#/people/${me.id}`, "aria-label": "Your profile" }, avatar(me.name, 32, me.avatar))));

  tabbar.hidden = false;
  const tab = (target, label, iconName) =>
    h("a", { href: `#${target}`, class: isActive(target, path) ? "active" : null }, icon(iconName), label);
  mount(tabbar,
    tab("/", "Home", "home"),
    tab("/events", "Events", "calendar"),
    createMenu(h("button", { type: "button", class: "tab-create", "aria-label": "Create" }, icon("plus"))),
    tab("/tribes", "Tribes", "users"),
    tab(`/people/${me.id}`, "Profile", "user"));
}

let routeToken = 0;

async function route() {
  const token = ++routeToken;
  remember();
  closeDrawer();
  renderHeader();
  refreshTribes();
  view.classList.remove("narrow", "medium");
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

/** Redraws the header and sidebar, e.g. after the user's name, picture or tribes change. */
export function refreshHeader() {
  renderHeader();
  refreshTribes(true);
}

window.addEventListener("themechange", () => renderHeader());
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.target.closest("input, textarea, select, [contenteditable]")) return;
  const search = document.querySelector(".header-search input");
  if (search && search.offsetParent) {
    event.preventDefault();
    search.focus();
  }
});

try {
  session.user = await api.me();
} catch {
  session.user = null;
}
route();
