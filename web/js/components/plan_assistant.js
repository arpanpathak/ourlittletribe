// "Describe it, and the model fills in the form": a box to type or speak a
// plan in your own words, which the model turns into a filled-in event.

import { api } from "../api.js";
import { h, mount, icon, toast, dateAndTimeInputs } from "../ui.js";
import { currentPosition } from "../map.js";
import { voiceButton } from "./voice.js";

const EXAMPLE = "e.g. “Next Saturday let's hike Rattlesnake Ledge. Meet at the Issaquah park and ride at 8, "
  + "coffee in Snoqualmie on the way. About 4 miles, dogs welcome.”";

/** The person's local date and time in words the model can count from, such as "Saturday 2026-10-31 13:05". */
function todayForModel() {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const { date, time } = dateAndTimeInputs(now.getTime() / 1000);
  return `${weekday} ${date} ${time}`;
}

/** Where the person is, if the browser shares it quickly; used to settle place names. */
async function positionOrNull() {
  try {
    return await currentPosition(3000);
  } catch {
    return null;
  }
}

/** The places the model named that the map didn't have. */
function unplacedQueries(draft) {
  const entries = [draft.meeting, ...draft.stops];
  const missing = [];

  for (const entry of entries) {
    if (entry && !entry.place) missing.push(entry.query);
  }

  return missing;
}

function header() {
  const text = h("div", {},
    h("h3", {}, "Describe it, and the model fills in the form"),
    h("p", { class: "small text-2" }, "Type or speak the plan in your own words: what, when, where to meet, stops on the way. You can change anything after."));

  return h("div", { class: "assist-head" }, h("span", { class: "assist-icon" }, icon("sparkles")), text);
}

/**
 * Builds the assistant. `fill(draft)` puts the draft into the form and
 * returns the names of what it filled, such as ["title", "date"].
 */
export function planAssistant({ fill }) {
  const idea = h("textarea", { class: "assist-input", rows: 3, maxlength: 2000, placeholder: EXAMPLE });
  const fillButton = h("button", { type: "button", class: "btn btn-primary" }, icon("sparkles"), "Fill in the form");
  const status = h("div", { class: "small muted" });

  function setBusy(busy) {
    fillButton.disabled = busy;

    if (busy) {
      fillButton.replaceChildren(h("span", { class: "spinner" }), "Filling in…");
      mount(status, "Reading your plan and finding the places on the map. This takes a few seconds.");
    } else {
      fillButton.replaceChildren(icon("sparkles"), "Fill in the form");
    }
  }

  function report(filled, missing) {
    const done = h("span", { class: "assist-done" }, icon("check", "sm"), `Filled in the ${filled.join(", ")}. Check everything before saving.`);
    const warning = missing.length
      ? h("span", { class: "assist-warn" }, ` Couldn't find on the map: ${missing.join("; ")}. Pick them in the Where section.`)
      : null;

    mount(status, done, warning);
  }

  async function fillFromIdea() {
    const text = idea.value.trim();
    if (text.length < 5) {
      idea.focus();
      toast("Say or type a sentence about the plan first", "error");
      return;
    }

    setBusy(true);

    try {
      const near = await positionOrNull();
      const draft = await api.draftEvent({ text, today: todayForModel(), lat: near?.lat ?? null, lng: near?.lng ?? null });

      const filled = fill(draft);
      report(filled, unplacedQueries(draft));
    } catch (error) {
      mount(status, h("span", { class: "assist-warn" }, error.message));
    } finally {
      setBusy(false);
    }
  }

  fillButton.addEventListener("click", fillFromIdea);

  const actions = h("div", { class: "row" }, voiceButton(idea, { label: "Speak the plan" }), fillButton);
  return h("section", { class: "assist-card" }, header(), idea, actions, status);
}
