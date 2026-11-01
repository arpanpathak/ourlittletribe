// Starting a tribe, or editing one. The form is laid out like the tribe page
// it makes: the cover across the top, the name as the title, the home area
// under it, then the description. Beside it on wide screens: the assistant
// that fills the form from a few spoken words, and a live preview of the
// tribe's card as it will appear in the list.

import { drafts, tribes } from "../api/client.js";
import type { Tribe, TribeDraft, TribeFields } from "../api/types.js";
import { assistantCard } from "../components/assistant.js";
import { coverMakerButton } from "../components/cover_maker.js";
import { MarkdownEditor } from "../components/markdown_editor.js";
import { picturePicker, type PicturePicker } from "../components/picture_picker.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { markdownToText } from "../markdown.js";
import { go, me } from "../session.js";
import { emptyState, errorMessage, toast } from "../ui/feedback.js";
import { gradientFor, initials, pictureUrl } from "../ui/pictures.js";

const OUTLINE = "## What we do\n\n\n## How often\n\n\n## Who it's for\n- \n";

const EXAMPLE = "e.g. “A Saturday morning walking group in Ballard. Easy 3 to 5 mile loops, "
  + "coffee after, dogs and kids welcome.”";

/** Most characters of the description shown on the preview card. */
const PREVIEW_TEXT = 140;

/** The live preview of the tribe's card in the list. */
class CardPreview {
  /** The preview, to put beside the form. */
  readonly element = h("div", { class: "card tribe-card preview-card", inert: true });

  /** Draws the card from what the form holds now. */
  draw(name: string, area: string, description: string, cover: string | null): void {
    const shownName = name || "Your tribe's name";
    const picture = cover
      ? h("img", { src: cover, alt: "" })
      : h("div", { class: "cover-fallback", style: gradientFor(name || "?") }, h("span", { class: "monogram" }, initials(name || "?")));

    const text = markdownToText(description).slice(0, PREVIEW_TEXT);
    mount(this.element,
      h("div", { class: "cover" }, picture),
      h("div", { class: "tribe-card-body" },
        h("h3", { class: name ? null : "muted" }, shownName),
        area ? h("div", { class: "meta-line" }, icon("pin"), h("span", {}, area)) : null,
        text ? h("p", { class: "small text-2 clamp-2" }, text) : h("p", { class: "small muted" }, "Your description shows here.")),
      h("div", { class: "tribe-card-foot" }, h("span", { class: "small muted" }, "1 member"), h("span", { class: "badge badge-accent" }, icon("check", "sm"), "Organizer")));
  }
}

/** The tribe form. */
class TribeForm {
  /** The form. */
  readonly element: HTMLFormElement;

  /** The name, shown as the page's title. */
  private readonly name: HTMLInputElement;
  /** Where the tribe meets. */
  private readonly area: HTMLInputElement;
  /** A problem with the name, under it. */
  private readonly nameError = h("div", { class: "studio-error", hidden: true });
  /** The square with the tribe's initials, beside the name. */
  private readonly monogram = h("div", { class: "studio-monogram" });
  private readonly description: MarkdownEditor;
  private readonly cover: PicturePicker;
  private readonly preview = new CardPreview();
  private readonly submit: HTMLButtonElement;

  constructor(private readonly tribe: Tribe | null) {
    this.name = h("input", { class: "title-input", maxlength: 80, placeholder: "Name your tribe", "aria-label": "Tribe name", value: tribe?.name ?? "" });
    this.area = h("input", { class: "fact-input", maxlength: 80, placeholder: "Where do you usually meet? e.g. Ballard, Seattle", "aria-label": "Home area", value: tribe?.home_area ?? "" });

    this.description = new MarkdownEditor({
      value: tribe?.description ?? "",
      maxLength: 4000,
      rows: 7,
      placeholder: "What you do, how often, who it's for. Easy weekend hikes, dogs welcome, coffee after.",
      outlines: [{ label: "About a tribe", markdown: OUTLINE }],
      details: () => this.details(),
    });

    this.cover = picturePicker(tribe?.cover_image ? pictureUrl(tribe.cover_image) : null, "A wide landscape works best. Or let the model draw one.");
    this.submit = h("button", { type: "submit", class: "btn btn-primary btn-lg" }, this.submitLabel);
    this.element = this.build();

    this.listen();
    this.refresh();
  }

  private get submitLabel(): string {
    return this.tribe ? "Save changes" : "Create tribe";
  }

  /* ── Building ───────────────────────────────────── */

  private coverArea(): HTMLElement {
    const describe = () => ({ subject: "tribe" as const, title: this.name.value, description: this.description.value(), place: this.area.value, when: "" });
    const draw = coverMakerButton(describe, this.cover.use, "overlay");
    return h("div", { class: "studio-cover" }, this.cover.element, h("div", { class: "studio-cover-tools" }, draw));
  }

  private identity(): HTMLElement {
    const where = h("div", { class: "fact-row" }, icon("pin"), this.area);
    return h("div", { class: "studio-identity" }, this.monogram, h("div", { class: "studio-title" }, this.name, this.nameError, where));
  }

  private build(): HTMLFormElement {
    const cancel = h("a", { class: "btn btn-ghost btn-lg", href: this.tribe ? `#/tribes/${this.tribe.id}` : "#/tribes" }, "Cancel");
    const story = h("section", { class: "studio-block" },
      h("div", { class: "studio-block-head" }, h("h3", {}, "What's it about?"), h("p", {}, "Shown on the tribe's page. Write with AI drafts it from the name and area.")),
      this.description.element);

    const sheet = h("section", { class: "card studio-sheet" }, this.coverArea(), this.identity(), story);
    const actions = h("div", { class: "studio-actions" }, cancel, this.submit);
    const main = h("div", { class: "studio-main" }, sheet, actions);

    const previewBlock = h("section", { class: "studio-preview" }, h("div", { class: "studio-side-label" }, icon("eye", "sm"), "How it shows in Tribes"), this.preview.element);
    const side = h("aside", { class: "studio-side" }, this.tribe ? null : this.assistant(), previewBlock);

    return h("form", { class: "studio", novalidate: true }, main, side);
  }

  private assistant(): HTMLElement {
    return assistantCard({
      title: "Describe it, and the model fills in the form",
      intro: "Say who you are, what you do, how often and where.",
      example: EXAMPLE,
      speakLabel: "Speak",
      busyText: "Reading what you said and writing it up…",
      fill: async (words) => ({ filled: this.fill(await drafts.tribe(words)), missing: [] }),
    });
  }

  /* ── Keeping the preview current ────────────────── */

  private listen(): void {
    for (const input of [this.name, this.area, this.description.textarea]) {
      input.addEventListener("input", () => this.refresh());
    }
    this.cover.element.addEventListener("picturechange", () => this.refresh());

    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save();
    });
  }

  private refresh(): void {
    const name = this.name.value.trim();
    this.monogram.textContent = initials(name || "?");
    this.monogram.setAttribute("style", gradientFor(name || "?"));
    this.preview.draw(name, this.area.value.trim(), this.description.value(), this.cover.shown());
  }

  /* ── The model ──────────────────────────────────── */

  /** Lines about the tribe, for the model writing its description. */
  private details(): string[] {
    const area = this.area.value.trim();
    return ["This is a tribe: a group that plans outings together.", `Name: ${this.name.value.trim() || "not named yet"}`, `Home area: ${area || "not given"}`];
  }

  /** Puts the model's draft in the form; returns what it filled. */
  fill(draft: TribeDraft): string[] {
    const filled: string[] = [];

    if (draft.name) {
      this.name.value = draft.name;
      filled.push("name");
    }
    if (draft.home_area) {
      this.area.value = draft.home_area;
      filled.push("home area");
    }
    if (draft.description) {
      this.description.setValue(draft.description);
      filled.push("description");
    }

    this.showNameError(null);
    this.refresh();
    return filled;
  }

  /* ── Saving ─────────────────────────────────────── */

  private showNameError(problem: string | null): void {
    this.nameError.hidden = !problem;
    this.nameError.textContent = problem ?? "";
    this.name.setAttribute("aria-invalid", problem ? "true" : "false");
  }

  private fields(): TribeFields {
    return { name: this.name.value.trim(), home_area: this.area.value.trim(), description: this.description.value() };
  }

  /** Uploads or removes the cover after saving; a failure here keeps the tribe. */
  private async saveCover(tribeId: string): Promise<void> {
    const change = this.cover.change();
    try {
      switch (change.kind) {
        case "new":
          await tribes.setCover(tribeId, change.file);
          break;
        case "removed":
          await tribes.removeCover(tribeId);
          break;
        case "unchanged":
          break;
      }
    } catch (error) {
      toast(`Saved, but the cover picture wasn't: ${errorMessage(error)}`, "error");
    }
  }

  private setBusy(busy: boolean): void {
    this.submit.disabled = busy;
    if (busy) this.submit.replaceChildren(h("span", { class: "spinner" }), this.tribe ? "Saving…" : "Creating…");
    else this.submit.replaceChildren(this.submitLabel);
  }

  private async save(): Promise<void> {
    if (!this.name.value.trim()) {
      this.showNameError("Give the tribe a name");
      this.name.focus();
      return;
    }
    this.showNameError(null);

    this.setBusy(true);
    try {
      const saved = this.tribe ? await tribes.update(this.tribe.id, this.fields()) : await tribes.create(this.fields());
      await this.saveCover(saved.id);
      toast(this.tribe ? "Changes saved" : `${saved.name} is ready`, "success");
      go(`/tribes/${saved.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
      this.setBusy(false);
    }
  }

  focus(): void {
    this.name.focus();
  }
}

/** Draws the form: a new tribe when `tribeId` is null, else an edit of that tribe. */
export async function renderTribeForm(view: HTMLElement, tribeId: string | null): Promise<void> {
  const tribe = tribeId ? (await tribes.detail(tribeId)).tribe : null;

  const mayEdit = !tribe || tribe.is_organizer || me().is_admin;
  if (!mayEdit) {
    mount(view, emptyState("alert", "You can't edit this tribe", "Only its organizers can.", h("a", { class: "btn", href: `#/tribes/${tribe.id}` }, "Back to the tribe")));
    return;
  }

  view.classList.add("wide");
  const form = new TribeForm(tribe);
  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, tribe ? "Edit tribe" : "Start a tribe"), h("p", {}, tribe ? tribe.name : "A tribe is your crew: the friends, club or neighbours you get outside with.")));

  mount(view, head, form.element);
  if (!tribe) form.focus();
}
