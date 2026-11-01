// "Make a cover with AI": the model reads the name, place, date and
// description and chooses a scene; the page draws it and offers the picture
// as the cover. Each press asks again, so a second try gives another scene.

import { drafts } from "../api/client.js";
import type { CoverRequest } from "../api/types.js";
import { coverFile } from "../cover_art.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";
import { actionButton } from "../ui/controls.js";
import { toast } from "../ui/feedback.js";

/** Where the button sits: under a picker with a note, or on top of a cover. */
export type CoverMakerPlace = "inline" | "overlay";

/** A button that makes a cover from `describe()` and hands the picture to `use`. */
export function coverMakerButton(describe: () => CoverRequest, use: (file: File) => void, place: CoverMakerPlace = "inline"): HTMLElement {
  const make = async () => {
    const request = describe();
    if (!request.title.trim()) {
      toast("Give it a name first, so the model knows what to draw", "error");
      return;
    }

    const design = await drafts.cover(request);
    use(await coverFile(design, `${request.subject}-cover`));
    toast("Cover drawn. Press again for a different one.", "success");
  };

  if (place === "overlay") return actionButton([icon("sparkles", "sm"), "Draw with AI"], make, { class: "btn btn-sm btn-overlay" });

  const button = actionButton([icon("sparkles", "sm"), "Make a cover with AI"], make, { class: "btn btn-sm btn-soft" });
  return h("div", { class: "cover-maker" }, button, h("span", { class: "tiny muted" }, "Drawn from the name, place and description."));
}
