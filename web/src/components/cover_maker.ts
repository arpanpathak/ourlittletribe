// The "Draw with AI" button beside a cover picker: it opens the cover
// studio and hands the drawn picture to the picker.

import type { CoverRequest } from "../api/types.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";
import { toast } from "../ui/feedback.js";
import { openCoverStudio } from "./cover_studio.js";

/** Where the button sits: under a picker with a note, or on top of a cover. */
export type CoverMakerPlace = "inline" | "overlay";

/** A button that opens the cover studio for `describe()` and hands the picture to `use`. */
export function coverMakerButton(describe: () => CoverRequest, use: (file: File) => void, place: CoverMakerPlace = "inline"): HTMLElement {
  const open = async () => {
    const request = describe();
    if (!request.title.trim()) {
      toast("Give it a name first, so the model knows what to draw", "error");
      return;
    }

    const file = await openCoverStudio(request);
    if (file) use(file);
  };

  const label = place === "overlay" ? "Draw with AI" : "Draw a cover with AI";
  const button = h("button", { type: "button", class: place === "overlay" ? "btn btn-sm btn-overlay" : "btn btn-sm btn-soft", onclick: () => void open() }, icon("sparkles", "sm"), label);
  if (place === "overlay") return button;

  return h("div", { class: "cover-maker" }, button, h("span", { class: "tiny muted" }, "The model describes a scene, you edit it, and it draws it."));
}
