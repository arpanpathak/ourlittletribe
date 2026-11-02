// "Describe it, and the model fills in the form": a box to type or speak in
// your own words, and a button that has the model fill the form from them.
// The event and tribe forms each give it their own words and filling step.

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { errorMessage, toast } from "../ui/feedback.js";
import { voiceButton } from "./voice.js";

/** What filling the form did. */
export interface FillReport {
  /** The names of what was filled, such as ["title", "date"]. */
  filled: string[];
  /** Places the model named that the map didn't have. */
  missing: string[];
}

/** What the card says and does. */
export interface AssistantOptions {
  /** The heading. */
  title: string;
  /** A line under the heading. */
  intro: string;
  /** The empty box's example. */
  example: string;
  /** The voice button's words. */
  speakLabel: string;
  /** What the status line says while the model works. */
  busyText: string;
  /** Has the model fill the form from the words. */
  fill: (words: string) => Promise<FillReport>;
}

function header(options: AssistantOptions): HTMLElement {
  const text = h("div", {}, h("h3", {}, options.title), h("p", { class: "small text-2" }, options.intro));
  return h("div", { class: "assist-head" }, h("span", { class: "assist-icon" }, icon("sparkles")), text);
}

function report(result: FillReport): HTMLElement[] {
  const done = h("span", { class: "assist-done" }, icon("check", "sm"), `Filled in the ${result.filled.join(", ")}. Check everything before saving.`);
  if (!result.missing.length) return [done];

  const warning = h("span", { class: "assist-warn" }, ` Couldn't find on the map: ${result.missing.join("; ")}. Pick them in the Where section.`);
  return [done, warning];
}

/** The assistant card. */
export function assistantCard(options: AssistantOptions): HTMLElement {
  const words = h("textarea", { class: "assist-input", rows: 3, maxlength: 2000, placeholder: options.example });
  const fillButton = h("button", { type: "button", class: "btn btn-primary" }, icon("sparkles"), "Fill in the form");
  const status = h("div", { class: "small muted assist-status" });

  function setBusy(busy: boolean): void {
    fillButton.disabled = busy;
    if (!busy) {
      fillButton.replaceChildren(icon("sparkles"), "Fill in the form");
      return;
    }

    fillButton.replaceChildren(h("span", { class: "spinner" }), "Filling in…");
    mount(status, options.busyText);
  }

  async function fillFromWords(): Promise<void> {
    const text = words.value.trim();
    if (text.length < 5) {
      words.focus();
      toast("Say or type a sentence about it first", "error");
      return;
    }

    setBusy(true);
    try {
      mount(status, report(await options.fill(text)));
    } catch (error) {
      mount(status, h("span", { class: "assist-warn" }, errorMessage(error)));
    } finally {
      setBusy(false);
    }
  }

  fillButton.addEventListener("click", () => void fillFromWords());

  const actions = h("div", { class: "row" }, voiceButton(words, { label: options.speakLabel }), fillButton);
  return h("section", { class: "assist-card" }, header(options), words, actions, status);
}
