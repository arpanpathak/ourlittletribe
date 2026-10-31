// Who is signed in, and moving between pages. Views read the user from here;
// the app shell listens for "header-stale" to redraw the header and sidebar.

import type { User } from "./api/types.js";

let current: User | null = null;

/** The signed-in user, or null before signing in. */
export function currentUser(): User | null {
  return current;
}

/** The signed-in user, for views that only draw once someone has signed in. */
export function me(): User {
  if (!current) throw new Error("Not signed in");
  return current;
}

/** Records who is signed in, or that nobody is. */
export function setUser(user: User | null): void {
  current = user;
}

/** Moves to a route such as `/events/abc`. */
export function go(path: string): void {
  window.location.hash = `#${path}`;
}

/** Replaces the current route without adding a history entry, such as when switching tabs. */
export function replaceRoute(path: string): void {
  history.replaceState(null, "", `#${path}`);
}

/** Asks the shell to redraw the header and sidebar, after a name, picture or tribe changes. */
export function refreshHeader(): void {
  window.dispatchEvent(new Event("header-stale"));
}
