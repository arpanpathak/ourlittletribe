// The event form's assistant: the plan in your own words becomes a title,
// description, date, time and places.

import { drafts } from "../api/client.js";
import type { EventDraft } from "../api/types.js";
import { dateAndTimeInputs } from "../format.js";
import { currentPosition } from "../map.js";
import { assistantCard } from "./assistant.js";

const EXAMPLE = "e.g. “Next Saturday let's hike Rattlesnake Ledge. Meet at the Issaquah park and ride at 8, "
  + "coffee in Snoqualmie on the way. About 4 miles, dogs welcome.”";

/** Puts a draft into the form; returns the names of what it filled, such as ["title", "date"]. */
export type FillForm = (draft: EventDraft) => string[];

/** The person's local date and time in words the model can count from, such as "Saturday 2026-10-31 13:05". */
function todayForModel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const { date, time } = dateAndTimeInputs(now.getTime() / 1000);
  return `${weekday} ${date} ${time}`;
}

/** The places the model named that the map didn't have. */
function unplaced(draft: EventDraft): string[] {
  const named = [draft.meeting_point, ...draft.stops];
  return named.flatMap((entry) => (entry && !entry.place ? [entry.query] : []));
}

/** The assistant card, which calls `fill` with the model's draft. */
export function planAssistant(fill: FillForm): HTMLElement {
  return assistantCard({
    title: "Describe it, and the model fills in the form",
    intro: "Type or speak the plan in your own words: what, when, where to meet, stops on the way. You can change anything after.",
    example: EXAMPLE,
    speakLabel: "Speak the plan",
    busyText: "Reading your plan, writing the description and finding every place on the map. With many places this takes up to a minute or two.",
    fill: async (words) => {
      const near = await currentPosition(3000).catch(() => null);
      const draft = await drafts.event(words, todayForModel(), near);
      return { filled: fill(draft), missing: unplaced(draft) };
    },
  });
}
