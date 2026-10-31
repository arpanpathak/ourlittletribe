// The app shell: who is signed in, the navigation, and the hash router.

import { api } from "./api.js";
import { logoMark } from "./art.js";
import { h, mount, avatar } from "./ui.js";
import { renderAuth } from "./views/auth.js";
import { renderHome } from "./views/home.js";
import { renderTribes } from "./views/tribes.js";
import { renderTribe } from "./views/tribe.js";
import { renderNewEvent } from "./views/new_event.js";
import { renderEvent } from "./views/event.js";
import { renderProfile } from "./views/profile.js";
import { renderSearch } from "./views/search.js";

const view = document.getElementById("view");

/** What every view can read: the signed-in user and a way to navigate. */
export const session = { user: null };

/** Moves to a route such as `/events/abc`. */
export function go(path) {
  window.location.hash = `#${path}`;
}

const ROUTES = [
  [/^\/$/, () => renderHome(view)],
  [/^\/tribes$/, () => renderTribes(view)],
  [/^\/tribes\/([^/]+)$/, (tribeId) => renderTribe(view, tribeId)],
  [/^\/events\/new$/, (_unused, query) => renderNewEvent(view, query.get("tribe"))],
  [/^\/events\/([^/]+)$/, (eventId) => renderEvent(view, eventId)],
  [/^\/people\/([^/]+)$/, (userId) => renderProfile(view, userId)],
  [/^\/search$/, (_unused, query) => renderSearch(view, query.get("q") || "")],
];

const NAV_LINKS = [
  ["/", "Home", "M3 11 L12 3 L21 11 M5 10 V21 H19 V10"],
  ["/tribes", "Tribes", "M3 20 L9 9 L13 15 L16 11 L21 20 Z"],
  ["/search", "Search", "M11 4 A7 7 0 1 1 10.9 4 M16 16 L21 21"],
];

function icon(path) {
  return h("span", {
    class: "nav-icon",
    html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
  });
}

function currentPath() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, queryText] = raw.split("?");
  return { path, query: new URLSearchParams(queryText || "") };
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function storedTheme() {
  try {
    return localStorage.getItem("olt-theme");
  } catch {
    return null;
  }
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("olt-theme", next);
  } catch {
    /* storage may be blocked; the toggle still works for this visit */
  }
}

function renderChrome() {
  const { path } = currentPath();
  mount(document.getElementById("brand"), h("span", { html: logoMark(30) }), h("span", { class: "brand-name" }, "OurLittleTribe"));
  const links = (cls) =>
    NAV_LINKS.map(([target, label, iconPath]) => {
      const active = target === "/" ? path === "/" : path.startsWith(target);
      return h("a", { href: `#${target}`, class: `${cls}${active ? " active" : ""}` }, icon(iconPath), h("span", {}, label));
    });
  const signedIn = Boolean(session.user);
  mount(document.getElementById("nav"), signedIn ? links("nav-link") : null);
  mount(document.getElementById("tabbar"), signedIn ? links("tab-link") : null);
  document.getElementById("tabbar").hidden = !signedIn;
  const themeButton = h("button", {
    class: "icon-button",
    title: "Switch light and dark",
    "aria-label": "Switch light and dark",
    onclick: toggleTheme,
    html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 13 A9 9 0 1 1 11 3 A7 7 0 0 0 21 13 Z"/></svg>`,
  });
  const me = signedIn
    ? h("a", { href: `#/people/${session.user.id}`, class: "me-link", title: "Your profile" }, avatar(session.user.name, 34))
    : null;
  mount(document.getElementById("topbar-end"), themeButton, me);
}

async function route() {
  renderChrome();
  if (!session.user) {
    renderAuth(view, async (user) => {
      session.user = user;
      await route();
    });
    return;
  }
  const { path, query } = currentPath();
  for (const [pattern, render] of ROUTES) {
    const match = path.match(pattern);
    if (match) {
      view.scrollTo?.(0, 0);
      window.scrollTo(0, 0);
      try {
        await render(match[1] ? decodeURIComponent(match[1]) : undefined, query);
      } catch (error) {
        mount(view, h("div", { class: "empty" }, h("h2", {}, "That didn't load"), h("p", {}, error.message)));
      }
      return;
    }
  }
  go("/");
}

window.addEventListener("hashchange", route);
window.addEventListener("signed-out", () => {
  if (session.user) {
    session.user = null;
    route();
  }
});

applyTheme(storedTheme());
try {
  session.user = await api.me();
} catch {
  session.user = null;
}
route();
