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

/** A button that makes a cover from `describe()` and hands the picture to `use`. */
export function coverMakerButton(describe: () => CoverRequest, use: (file: File) => void): HTMLElement {
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

  const button = actionButton([icon("sparkles", "sm"), "Make a cover with AI"], make, { class: "btn btn-sm btn-soft" });
  return h("div", { class: "cover-maker" }, button, h("span", { class: "tiny muted" }, "Drawn from the name, place and description."));
}
