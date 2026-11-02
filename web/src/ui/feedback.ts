// Telling people what happened: short messages, empty pages and loading placeholders.

import { h } from "../dom.js";
import { spotFor } from "../art.js";
import { icon, type IconName } from "../icons.js";

/** How a message looks. */
export type ToastKind = "info" | "success" | "error";

const TOAST_ICONS: Record<ToastKind, IconName> = { info: "info", success: "check", error: "alert" };

/** How long a message stays, milliseconds. */
const TOAST_MILLISECONDS = 3600;

/** Shows a short message in the corner for a few seconds. */
export function toast(message: string, kind: ToastKind = "info"): void {
  const shelf = document.getElementById("toasts");
  if (!shelf) return;

  const role = kind === "error" ? "alert" : "status";
  const note = h("div", { class: `toast toast-${kind}`, role }, icon(TOAST_ICONS[kind]), h("span", {}, message));
  shelf.appendChild(note);

  setTimeout(() => note.classList.add("leaving"), TOAST_MILLISECONDS);
  setTimeout(() => note.remove(), TOAST_MILLISECONDS + 400);
}

/** The text of any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** An empty page: a small drawing (or an icon), a title, a sentence and actions. */
export function emptyState(iconName: IconName, title: string, text: string | null, ...actions: HTMLElement[]): HTMLElement {
  const scene = spotFor(iconName);
  const picture = scene ? h("div", { html: scene }) : h("div", { class: "empty-icon" }, icon(iconName));

  return h("div", { class: "empty" },
    picture,
    h("h3", {}, title),
    text ? h("p", {}, text) : null,
    actions.length ? h("div", { class: "row" }, actions) : null);
}

/** Grey blocks where a page will be, while it loads. */
export function loadingPage(): HTMLElement {
  const block = (style: string) => h("div", { class: "skeleton", style });
  return h("div", { class: "loading-page" }, block("height:36px;width:40%"), block("height:220px"), block("height:120px"));
}
