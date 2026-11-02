// Dialogs over the page.

import { h, type Child } from "../dom.js";
import { icon } from "../icons.js";

/** What a dialog shows. `close(value)` ends it with that value. */
export interface ModalOptions<Result> {
  /** The heading. */
  title: string;
  /** The body. */
  build: (close: (value?: Result) => void) => Child;
  /** Buttons for the footer. */
  actions?: (close: (value?: Result) => void) => HTMLElement[];
  /** A wider dialog, for galleries and long forms. */
  wide?: boolean;
}

/** Opens a dialog; resolves with what it was closed with, or undefined. */
export function openModal<Result>(options: ModalOptions<Result>): Promise<Result | undefined> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: options.wide ? "modal modal-wide" : "modal" });
    let result: Result | undefined;

    const close = (value?: Result) => {
      result = value;
      dialog.close();
    };

    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });

    const closeButton = h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": "Close", onclick: () => close() }, icon("x"));
    const buttons = options.actions ? options.actions(close) : [];
    const footer = buttons.length ? h("div", { class: "modal-foot" }, buttons) : null;

    dialog.appendChild(
      h("div", { class: "modal-box" },
        h("div", { class: "modal-head" }, h("h2", {}, options.title), closeButton),
        h("div", { class: "modal-body" }, options.build(close)),
        footer));
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/** Asks a yes-or-no question; resolves true for yes. */
export async function confirmAction(title: string, text: string, confirmLabel = "Confirm", danger = false): Promise<boolean> {
  const answer = await openModal<boolean>({
    title,
    build: () => h("p", { class: "text-2" }, text),
    actions: (close) => [
      h("button", { type: "button", class: "btn", onclick: () => close(false) }, "Cancel"),
      h("button", { type: "button", class: danger ? "btn btn-danger-solid" : "btn btn-primary", onclick: () => close(true) }, confirmLabel),
    ],
  });
  return answer === true;
}
