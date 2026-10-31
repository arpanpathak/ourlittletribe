// What every tab of the event page can see and do. The page owns the event's
// details; a tab reads them, and asks the page to reload or switch tabs.

import type { EventDetail, User } from "../../api/types.js";

/** The event page's tabs. */
export type Tab = "overview" | "list" | "route" | "photos";

export const TABS: Tab[] = ["overview", "list", "route", "photos"];

/** The page, as a tab sees it. */
export interface EventScreen {
  /** The event's details as last loaded. */
  readonly detail: EventDetail;
  /** The signed-in person. */
  readonly me: User;
  /** Loads the details again and redraws. */
  reload(): Promise<void>;
  /** Changes the details in place, such as after a photo upload, and redraws. */
  update(change: (detail: EventDetail) => void): void;
  /** Opens another tab. */
  openTab(tab: Tab): void;
}

/** A tab's content, and anything to do once it is in the page, such as making a map. */
export interface TabView {
  /** The content. */
  element: HTMLElement;
  /** Runs after the content is in the page. */
  start?: () => void;
}
