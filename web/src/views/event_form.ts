// Planning a new event, or editing one: what, when, where on the map, and a
// cover picture. The model can fill it from the plan in your own words, write
// the description, and draw the cover.

import { events, tribes as tribesApi } from "../api/client.js";
import type { Event, EventDetail, EventDraft, EventFields, Place, Tribe } from "../api/types.js";
import { coverMakerButton } from "../components/cover_maker.js";
import { LocationsEditor } from "../components/locations_editor.js";
import { MarkdownEditor, type Outline } from "../components/markdown_editor.js";
import { picturePicker, type PicturePicker } from "../components/picture_picker.js";
import { planAssistant } from "../components/plan_assistant.js";
import { h, mount, type Child } from "../dom.js";
import { dateAndTimeInputs, unixFromInputs } from "../format.js";
import { icon } from "../icons.js";
import { PLACE_KINDS } from "../itinerary.js";
import { go } from "../session.js";
import { field, labelled, type Field } from "../ui/controls.js";
import { emptyState, errorMessage, toast } from "../ui/feedback.js";
import { confirmAction } from "../ui/modal.js";
import { pictureUrl } from "../ui/pictures.js";

/** Starting outlines for a description, offered from the editor's Outline menu. */
const OUTLINES: Outline[] = [
  { label: "Hike or walk", markdown: "## The plan\n- **Distance:** \n- **Elevation gain:** \n- **Pace:** \n- **Back by:** \n\n## What to expect\n\n\n## Good to know\n- [ ] Parking pass\n- [ ] Dogs welcome?\n" },
  { label: "Picnic or meal", markdown: "## The plan\n\n\n## Food\n- Who brings what: \n\n## Good to know\n- \n" },
  { label: "Schedule", markdown: "## Schedule\n1. **9:00** Meet up\n2. **9:30** Leave\n3. **12:00** Lunch\n4. **3:00** Head back\n" },
];

const DESCRIPTION_PLACEHOLDER = "What's the plan? Distance and elevation, pace, what to expect, food, dogs or kids, when you'll head back…\n\n"
  + "Use the toolbar for headings, lists and pictures, pick an Outline, or let Write with AI draft it.";

const WHERE_INTRO = "Start with where everyone meets. Add stops on the way, optional stops, or the venue if the event happens "
  + "somewhere else. Search by name, or select a row and click the map.";

/** How far in the past a start time may be before it is refused, seconds. */
const PAST_GRACE = 3600;

function nextSaturdayMorning(): number {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** A form section: a title and a sentence on the left, the fields on the right. */
function section(title: string, text: string, ...body: Child[]): HTMLElement {
  const intro = h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text));
  return h("div", { class: "form-section" }, intro, h("div", { class: "form-section-body" }, body));
}

/** A form section whose body takes the full width under its title. */
function wideSection(title: string, text: string, body: HTMLElement): HTMLElement {
  const intro = h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text));
  return h("div", { class: "form-section form-section-full" }, intro, body);
}

/** The meeting point to start from: the event's own, or one passed in the link from "Plan here". */
function initialMeetingPoint(event: Event | null, query: URLSearchParams): Place | null {
  if (event) return event.meeting_point;

  const lat = Number(query.get("lat"));
  const lng = Number(query.get("lng"));
  if (!query.get("lat") || !query.get("lng") || Number.isNaN(lat) || Number.isNaN(lng)) return null;

  return { name: query.get("name") ?? "", lat, lng };
}

/** Flashes the fields the model just filled. */
function flash(elements: HTMLElement[]): void {
  for (const element of elements) {
    element.classList.remove("just-filled");
    void element.offsetWidth;
    element.classList.add("just-filled");
  }
}

/** The event form's inputs and saving. */
class EventForm {
  /** The form. */
  readonly element: HTMLFormElement;
  /** The places editor, whose map starts once the form is in the page. */
  readonly places: LocationsEditor;

  private readonly tribeSelect: HTMLSelectElement;
  private readonly title: HTMLInputElement;
  private readonly date: HTMLInputElement;
  private readonly time: HTMLInputElement;
  private readonly titleField: Field;
  private readonly dateField: Field;
  private readonly timeField: Field;
  private readonly description: MarkdownEditor;
  private readonly cover: PicturePicker;
  private readonly submit: HTMLButtonElement;

  constructor(private readonly detail: EventDetail | null, myTribes: Tribe[], query: URLSearchParams) {
    const event = detail?.event ?? null;
    const when = dateAndTimeInputs(event ? event.starts_at : nextSaturdayMorning());
    const requestedTribe = query.get("tribe");

    const tribeOptions = myTribes.map((tribe) => h("option", { value: tribe.id, selected: tribe.id === requestedTribe ? true : null }, tribe.name));
    this.tribeSelect = h("select", { name: "tribe" }, tribeOptions);
    this.title = h("input", { name: "title", maxlength: 120, placeholder: "e.g. Skyline Trail loop at Paradise", value: event?.title ?? "" });
    this.date = h("input", { type: "date", value: when.date, required: true });
    this.time = h("input", { type: "time", value: when.time, required: true, step: 300 });

    this.titleField = field("Title", this.title);
    this.dateField = field("Date", this.date);
    this.timeField = field("Start time", this.time, { hint: Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ") });

    this.places = new LocationsEditor(initialMeetingPoint(event, query), detail?.stops ?? []);
    this.cover = picturePicker(event?.cover_image ? pictureUrl(event.cover_image) : null);
    this.description = new MarkdownEditor({ value: event?.description ?? "", maxLength: 8000, placeholder: DESCRIPTION_PLACEHOLDER, outlines: OUTLINES, details: () => this.describe() });

    this.submit = h("button", { type: "submit", class: "btn btn-primary" }, this.submitLabel);
    this.element = this.build();
    this.element.addEventListener("submit", (submitted) => {
      submitted.preventDefault();
      void this.save();
    });
  }

  private get event(): Event | null {
    return this.detail?.event ?? null;
  }

  private get submitLabel(): string {
    return this.event ? "Save changes" : "Create event";
  }

  /* ── Building ───────────────────────────────────── */

  private build(): HTMLFormElement {
    const event = this.event;
    const tribeRow = event
      ? labelled("Tribe", h("div", { class: "text-2" }, event.tribe_name))
      : field("Tribe", this.tribeSelect, { hint: "Everyone in this tribe will see the event." }).element;
    const descriptionHint = "Optional, but details help people decide, and help the model plan the packing list.";

    const maker = coverMakerButton(() => ({ subject: "event", title: this.title.value, description: this.description.value(), place: this.placeWords(), when: this.whenWords() }), this.cover.use);
    const cancel = h("a", { class: "btn btn-ghost", href: event ? `#/events/${event.id}` : "#/events" }, "Cancel");

    return h("form", { class: "card", novalidate: true },
      section("Basics", "What's the plan? The description also helps the packing-list model suggest the right things.",
        tribeRow, this.titleField.element, labelled("Description", this.description.element, descriptionHint)),
      section("Date and time", "When should people be at the meeting point?", h("div", { class: "field-row" }, this.dateField.element, this.timeField.element)),
      wideSection("Where", WHERE_INTRO, this.places.element),
      section("Cover picture", "Shown at the top of the event and on its card. Without one, the card shows a map.", this.cover.element, maker),
      event ? this.deleteSection(event) : null,
      h("div", { class: "form-actions" }, cancel, this.submit));
  }

  private deleteSection(event: Event): HTMLElement {
    const remove = async () => {
      const warning = `“${event.title}” and everything attached to it will be deleted for everyone. This can't be undone.`;
      if (!(await confirmAction("Delete this event?", warning, "Delete event", true))) return;

      try {
        await events.remove(event.id);
        toast("Event deleted");
        go(`/tribes/${event.tribe_id}`);
      } catch (error) {
        toast(errorMessage(error), "error");
      }
    };

    const button = h("button", { type: "button", class: "btn btn-danger", onclick: () => void remove() }, icon("trash"), "Delete event");
    return section("Delete event", "This removes the event, its packing list and its photos for everyone.", h("div", {}, button));
  }

  /* ── What the model reads ───────────────────────── */

  private whenWords(): string {
    if (!this.date.value) return "";

    const starts = new Date(`${this.date.value}T${this.time.value || "00:00"}`);
    return starts.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  /** The venue if there is one, else the meeting point. */
  private placeWords(): string {
    const where = this.places.peek();
    const venue = where.stops.find((stop) => stop.kind === "venue");
    return venue?.name ?? where.meetingPoint?.name ?? "";
  }

  /** The form so far as lines, for the model writing the description. */
  private describe(): string[] {
    const tribeName = this.event?.tribe_name ?? this.tribeSelect.selectedOptions[0]?.textContent ?? "";
    const where = this.places.peek();

    const lines = [`Tribe: ${tribeName}`];
    if (this.title.value.trim()) lines.unshift(`Title: ${this.title.value.trim()}`);
    if (this.date.value) lines.push(`Starts: ${this.whenWords()}`);
    if (where.meetingPoint) lines.push(`Meeting point: ${where.meetingPoint.name}`);

    for (const stop of where.stops) {
      const note = stop.note ? ` (${stop.note})` : "";
      lines.push(`${PLACE_KINDS[stop.kind].label}: ${stop.name}${note}`);
    }
    return lines;
  }

  /** Puts a draft from the plan assistant into the form; returns what it filled. */
  fill(draft: EventDraft): string[] {
    const filled: string[] = [];

    const tribeOffered = [...this.tribeSelect.options].some((option) => option.value === draft.tribe_id);
    if (!this.event && draft.tribe_id && tribeOffered) {
      this.tribeSelect.value = draft.tribe_id;
      filled.push("tribe");
    }

    if (draft.title) {
      this.title.value = draft.title;
      this.titleField.setError(null);
      filled.push("title");
    }
    if (draft.description) {
      this.description.showWritten(draft.description);
      filled.push("description");
    }
    if (draft.date) {
      this.date.value = draft.date;
      this.dateField.setError(null);
      filled.push("date");
    }
    if (draft.time) {
      this.time.value = draft.time;
      filled.push("time");
    }
    if (draft.meeting_point || draft.stops.length) {
      this.places.set(draft.meeting_point, draft.stops);
      filled.push("places");
    }

    flash([this.title, this.description.element, this.date, this.time, this.places.element]);
    return filled;
  }

  /* ── Saving ─────────────────────────────────────── */

  /** Marks problems with the title and time; returns the first input to fix, or null. */
  private firstProblem(): HTMLInputElement | null {
    const start = unixFromInputs(this.date.value, this.time.value);
    const inThePast = Boolean(this.date.value && this.time.value) && start < Date.now() / 1000 - PAST_GRACE;

    const checks: Array<[Field, HTMLInputElement, string | null]> = [
      [this.titleField, this.title, this.title.value.trim() ? null : "Give the event a title"],
      [this.dateField, this.date, !this.date.value ? "Pick a date" : inThePast ? "That's in the past" : null],
      [this.timeField, this.time, this.time.value ? null : "Pick a start time"],
    ];

    for (const [target, , problem] of checks) target.setError(problem);
    return checks.find(([, , problem]) => problem !== null)?.[1] ?? null;
  }

  private fields(): EventFields | null {
    const where = this.places.value();
    if (!where) return null;

    const start = unixFromInputs(this.date.value, this.time.value);
    return {
      title: this.title.value.trim(),
      description: this.description.value(),
      meeting_point: where.meetingPoint,
      stops: where.stops,
      starts_at: start,
      tz_offset_minutes: -new Date(start * 1000).getTimezoneOffset(),
    };
  }

  /** Uploads or removes the cover after saving; a failure here keeps the event. */
  private async saveCover(eventId: string): Promise<void> {
    const change = this.cover.change();
    try {
      switch (change.kind) {
        case "new":
          await events.setCover(eventId, change.file);
          break;
        case "removed":
          await events.removeCover(eventId);
          break;
        case "unchanged":
          break;
      }
    } catch (error) {
      toast(`The event was saved, but the cover picture wasn't: ${errorMessage(error)}`, "error");
    }
  }

  private setSaving(saving: boolean): void {
    this.submit.disabled = saving;
    if (saving) this.submit.replaceChildren(h("span", { class: "spinner" }), this.event ? "Saving…" : "Creating…");
    else this.submit.replaceChildren(this.submitLabel);
  }

  private async save(): Promise<void> {
    const problem = this.firstProblem();
    if (problem) {
      problem.focus();
      return;
    }

    const fields = this.fields();
    if (!fields) return;

    this.setSaving(true);
    try {
      const saved = this.event ? await events.update(this.event.id, fields) : await events.create(this.tribeSelect.value, fields);
      await this.saveCover(saved.id);
      toast(this.event ? "Changes saved" : "Event created", "success");
      go(`/events/${saved.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
      this.setSaving(false);
    }
  }

  focus(): void {
    this.title.focus();
  }
}

function cannotEdit(view: HTMLElement, eventId: string): void {
  const back = h("a", { class: "btn", href: `#/events/${eventId}` }, "Back to the event");
  mount(view, emptyState("alert", "You can't edit this event", "Only its planner and the tribe's organizers can.", back));
}

function needsATribe(view: HTMLElement): void {
  const browse = h("a", { class: "btn", href: "#/tribes" }, "Browse tribes");
  const start = h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe");
  const text = "Events belong to a tribe, so everyone in it can see the plan. Join one, or start your own.";

  mount(view, h("div", { class: "card" }, emptyState("users", "Join a tribe first", text, browse, start)));
}

/** Draws the form: a new event when `eventId` is null, else an edit of that event. */
export async function renderEventForm(view: HTMLElement, eventId: string | null, query = new URLSearchParams()): Promise<void> {
  const [tribes, detail] = await Promise.all([tribesApi.list(), eventId ? events.detail(eventId) : Promise.resolve(null)]);
  const myTribes = tribes.filter((tribe) => tribe.is_member);
  view.classList.add("medium");

  if (eventId && !detail?.can_manage) {
    cannotEdit(view, eventId);
    return;
  }
  if (!detail && !myTribes.length) {
    needsATribe(view);
    return;
  }

  const form = new EventForm(detail, myTribes, query);
  const event = detail?.event ?? null;
  const heading = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, event ? "Edit event" : "New event"), h("p", {}, event ? event.title : "Plan an outing for your tribe.")));

  mount(view, heading, event ? null : planAssistant((draft) => form.fill(draft)), form.element);
  form.places.start();
  if (!event) form.focus();
}
