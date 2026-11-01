// The app: who is signed in, the hash router, and the frame around each page.

import { ApiError, account } from "./api/client.js";
import { Chrome, currentLocation } from "./chrome.js";
import { h, mount } from "./dom.js";
import { currentUser, go, setUser } from "./session.js";
import { emptyState, errorMessage, loadingPage, toast } from "./ui/feedback.js";
import { renderAuth } from "./views/auth.js";
import { renderEvent } from "./views/event/page.js";
import { renderEventForm } from "./views/event_form.js";
import { renderExplore } from "./views/explore.js";
import { renderFeed } from "./views/feed.js";
import { renderProfile } from "./views/profile.js";
import { renderSearch } from "./views/search.js";
import { renderTribe } from "./views/tribe.js";
import { renderTribeForm } from "./views/tribe_form.js";
import { renderTribes } from "./views/tribes.js";

/** Draws one page. `id` is the route's one part in brackets, if it has one. */
type Render = (view: HTMLElement, id: string, query: URLSearchParams) => Promise<void>;

/** A route: the paths it matches, and how it draws. */
interface Route {
  /** Matches the path; its first group, if any, becomes `id`. */
  pattern: RegExp;
  /** Draws the page. */
  render: Render;
}

const ROUTES: Route[] = [
  { pattern: /^\/$/, render: (view) => renderFeed(view) },
  { pattern: /^\/events$/, render: (view, _id, query) => renderExplore(view, query) },
  { pattern: /^\/events\/new$/, render: (view, _id, query) => renderEventForm(view, null, query) },
  { pattern: /^\/events\/([^/]+)\/edit$/, render: (view, id) => renderEventForm(view, id) },
  { pattern: /^\/events\/([^/]+)$/, render: (view, id, query) => renderEvent(view, id, query.get("tab")) },
  { pattern: /^\/tribes$/, render: (view) => renderTribes(view) },
  { pattern: /^\/tribes\/new$/, render: (view) => renderTribeForm(view, null) },
  { pattern: /^\/tribes\/([^/]+)\/edit$/, render: (view, id) => renderTribeForm(view, id) },
  { pattern: /^\/tribes\/([^/]+)$/, render: (view, id, query) => renderTribe(view, id, query.get("tab")) },
  { pattern: /^\/people\/([^/]+)$/, render: (view, id) => renderProfile(view, id) },
  { pattern: /^\/search$/, render: (view, _id, query) => renderSearch(view, query.get("q") ?? "") },
];

const view = document.getElementById("view") ?? document.body;
const chrome = new Chrome(() => void route());

/** Counts page loads, so a slow page never replaces a newer one. */
let routeNumber = 0;

function failure(error: unknown): HTMLElement {
  const missing = error instanceof ApiError && error.status === 404;
  const back = h("a", { class: "btn", href: "#/" }, "Back to your feed");

  if (missing) return emptyState("compass", "Not found", "It may have been deleted, or the link is wrong.", back);
  return emptyState("alert", "That didn't load", errorMessage(error), back);
}

async function route(): Promise<void> {
  routeNumber += 1;
  const number = routeNumber;

  chrome.remember();
  chrome.closeDrawer();
  chrome.draw();
  void chrome.refreshTribes();
  view.classList.remove("narrow", "medium", "wide");
  view.classList.add("page");

  if (!currentUser()) {
    renderAuth(view, (user) => {
      setUser(user);
      void route();
    });
    return;
  }

  const { path, query } = currentLocation();
  const matched = ROUTES.map((candidate) => ({ candidate, match: path.match(candidate.pattern) })).find(({ match }) => match);
  if (!matched?.match) {
    go("/");
    return;
  }

  window.scrollTo(0, 0);
  mount(view, loadingPage());
  try {
    const id = matched.match[1] ? decodeURIComponent(matched.match[1]) : "";
    await matched.candidate.render(view, id, query);
  } catch (error) {
    if (number === routeNumber) mount(view, failure(error));
  }
}

function focusSearchOnSlash(event: KeyboardEvent): void {
  const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
  if (event.key !== "/" || typing) return;

  const search = document.querySelector<HTMLInputElement>(".header-search input");
  if (!search?.offsetParent) return;

  event.preventDefault();
  search.focus();
}

window.addEventListener("hashchange", () => void route());
window.addEventListener("themechange", () => chrome.draw());
window.addEventListener("header-stale", () => {
  chrome.draw();
  void chrome.refreshTribes(true);
});
window.addEventListener("signed-out", () => {
  if (!currentUser()) return;

  setUser(null);
  toast("Your session ended. Please sign in again.");
  void route();
});
document.addEventListener("keydown", focusSearchOnSlash);

setUser(await account.me().catch(() => null));
void route();
