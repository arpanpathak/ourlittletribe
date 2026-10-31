// Starting a tribe, or editing one: name, area, description and a cover
// picture. The model can fill the form from a few spoken words, write the
// description, and draw the cover.

import { drafts, tribes } from "../api/client.js";
import type { Tribe, TribeDraft, TribeFields } from "../api/types.js";
import { assistantCard } from "../components/assistant.js";
import { coverMakerButton } from "../components/cover_maker.js";
import { MarkdownEditor } from "../components/markdown_editor.js";
import { picturePicker, type PicturePicker } from "../components/picture_picker.js";
import { h, mount, type Child } from "../dom.js";
import { go, me } from "../session.js";
import { field, labelled, type Field } from "../ui/controls.js";
import { emptyState, errorMessage, toast } from "../ui/feedback.js";
import { pictureUrl } from "../ui/pictures.js";

const OUTLINE = "## What we do\n\n\n## How often\n\n\n## Who it's for\n- \n";

const EXAMPLE = "e.g. “A Saturday morning walking group in Ballard. Easy 3 to 5 mile loops, "
  + "coffee after, dogs and kids welcome.”";

function section(title: string, text: string, ...body: Child[]): HTMLElement {
  return h("div", { class: "form-section" },
    h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text)),
    h("div", { class: "form-section-body" }, body));
}

/** The tribe form's inputs. */
class TribeForm {
  /** The form. */
  readonly element: HTMLFormElement;

  private readonly name: HTMLInputElement;
  private readonly area: HTMLInputElement;
  private readonly nameField: Field;
  private readonly description: MarkdownEditor;
  private readonly cover: PicturePicker;
  private readonly submit: HTMLButtonElement;

  constructor(private readonly tribe: Tribe | null) {
    this.name = h("input", { maxlength: 80, placeholder: "e.g. Cascade Morning Walkers", value: tribe?.name ?? "" });
    this.area = h("input", { maxlength: 80, placeholder: "e.g. Ballard, Seattle", value: tribe?.home_area ?? "" });
    this.nameField = field("Name", this.name);

    this.description = new MarkdownEditor({
      value: tribe?.description ?? "",
      maxLength: 4000,
      rows: 6,
      placeholder: "What you do, how often, who it's for. Easy weekend hikes, dogs welcome, coffee after.",
      outlines: [{ label: "About a tribe", markdown: OUTLINE }],
      details: () => this.details(),
    });

    this.cover = picturePicker(tribe?.cover_image ? pictureUrl(tribe.cover_image) : null);
    const maker = coverMakerButton(() => ({ subject: "tribe", title: this.name.value, description: this.description.value(), place: this.area.value, when: "" }), this.cover.use);

    this.submit = h("button", { type: "submit", class: "btn btn-primary" }, this.submitLabel);
    const cancel = h("a", { class: "btn btn-ghost", href: tribe ? `#/tribes/${tribe.id}` : "#/tribes" }, "Cancel");

    this.element = h("form", { class: "card", novalidate: true },
      section("About the tribe", "This is what people see when they browse tribes.",
        this.nameField.element,
        field("Home area", this.area, { hint: "Where you usually meet. Optional." }).element,
        labelled("Description", this.description.element)),
      section("Cover picture", "Shown at the top of the tribe's page and on its card.", this.cover.element, maker),
      h("div", { class: "form-actions" }, cancel, this.submit));

    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save();
    });
  }

  private get submitLabel(): string {
    return this.tribe ? "Save changes" : "Create tribe";
  }

  /** Lines about the tribe, for the model writing its description. */
  private details(): string[] {
    const area = this.area.value.trim();
    return [
      "This is a tribe: a group that plans outings together.",
      `Name: ${this.name.value.trim() || "not named yet"}`,
      `Home area: ${area || "not given"}`,
    ];
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
    return filled;
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
      this.nameField.setError("Give the tribe a name");
      this.name.focus();
      return;
    }
    this.nameField.setError(null);

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

function tribeAssistant(form: TribeForm): HTMLElement {
  return assistantCard({
    title: "Describe your tribe, and the model fills in the form",
    intro: "Say who you are, what you do, how often and where. You can change anything after.",
    example: EXAMPLE,
    speakLabel: "Speak about it",
    busyText: "Reading what you said and writing it up. This takes a few seconds.",
    fill: async (words) => ({ filled: form.fill(await drafts.tribe(words)), missing: [] }),
  });
}

/** Draws the form: a new tribe when `tribeId` is null, else an edit of that tribe. */
export async function renderTribeForm(view: HTMLElement, tribeId: string | null): Promise<void> {
  const tribe = tribeId ? (await tribes.detail(tribeId)).tribe : null;
  view.classList.add("narrow");

  const mayEdit = !tribe || tribe.is_organizer || me().is_admin;
  if (!mayEdit) {
    mount(view, emptyState("alert", "You can't edit this tribe", "Only its organizers can.", h("a", { class: "btn", href: `#/tribes/${tribe.id}` }, "Back to the tribe")));
    return;
  }

  const form = new TribeForm(tribe);
  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, tribe ? "Edit tribe" : "New tribe"), h("p", {}, tribe ? tribe.name : "Start a group for the people you get outside with.")));

  mount(view, head, tribe ? null : tribeAssistant(form), form.element);
  if (!tribe) form.focus();
}
