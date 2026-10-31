// Planning a new event, or editing one: what, when, where on the map, and a cover picture.

import { api } from "../api.js";
import { h, mount, icon, field, toast, emptyState, confirmAction, dateAndTimeInputs, unixFromInputs, pictureUrl } from "../ui.js";
import { go } from "../app.js";
import { locationsEditor } from "../components/locations_editor.js";
import { markdownEditor } from "../components/markdown_editor.js";
import { picturePicker } from "../components/picture_picker.js";
import { planAssistant } from "../components/plan_assistant.js";
import { PLACE_KINDS } from "../stops.js";

/** Starting outlines for a description, offered from the editor's Outline menu. */
const EVENT_OUTLINES = [
  ["Hike or walk", "## The plan\n- **Distance:** \n- **Elevation gain:** \n- **Pace:** \n- **Back by:** \n\n## What to expect\n\n\n## Good to know\n- [ ] Parking pass\n- [ ] Dogs welcome?\n"],
  ["Picnic or meal", "## The plan\n\n\n## Food\n- Who brings what: \n\n## Good to know\n- \n"],
  ["Schedule", "## Schedule\n1. **9:00** Meet up\n2. **9:30** Leave\n3. **12:00** Lunch\n4. **3:00** Head back\n"],
];

const DESCRIPTION_PLACEHOLDER = "What's the plan? Distance and elevation, pace, what to expect, food, dogs or kids, when you'll head back…\n\n"
  + "Use the toolbar for headings, lists and pictures, pick an Outline, or let Write with AI draft it.";

const WHERE_INTRO = "Start with where everyone meets. Add stops on the way, optional stops, or the venue if the event happens "
  + "somewhere else. Search by name, or select a row and click the map.";

function nextSaturdayMorning() {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** A form section: a title and a sentence on the left, the fields on the right. */
function section(title, text, ...body) {
  const intro = h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text));
  return h("div", { class: "form-section" }, intro, h("div", { class: "form-section-body" }, body));
}

/** A form section whose body takes the full width under its title. */
function wideSection(title, text, body) {
  const intro = h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text));
  return h("div", { class: "form-section form-section-full" }, intro, body);
}

/** A label above something that is not a single input, such as an editor. */
function labelled(label, content, hint = null) {
  const hintLine = hint ? h("div", { class: "hint" }, hint) : null;
  return h("div", { class: "field" }, h("span", { class: "field-label" }, label), content, hintLine);
}

/** The meeting point to start from: the event's own, or one passed in the link from "Plan here". */
function initialMeetingPoint(event, query) {
  if (event) {
    return { name: event.place_name, detail: "", lat: event.lat, lng: event.lng };
  }

  if (query.get("lat") && query.get("lng")) {
    return { name: query.get("name") || "", detail: "", lat: Number(query.get("lat")), lng: Number(query.get("lng")) };
  }

  return null;
}

/** Saves the cover change, if any; reports a failure without losing the saved event. */
async function saveCover(eventId, change) {
  if (!change) return;

  try {
    if (change.file) await api.setEventCover(eventId, change.file);
    else if (change.removed) await api.removeEventCover(eventId);
  } catch (error) {
    toast(`The event was saved, but the cover picture wasn't: ${error.message}`, "error");
  }
}

function cannotEdit(view, eventId) {
  const back = h("a", { class: "btn", href: `#/events/${eventId}` }, "Back to the event");
  mount(view, emptyState("alert", "You can't edit this event", "Only its planner and the tribe's organizers can.", back));
}

function needsATribe(view) {
  const browse = h("a", { class: "btn", href: "#/tribes" }, "Browse tribes");
  const start = h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe");
  const text = "Events belong to a tribe, so everyone in it can see the plan. Join one, or start your own.";

  mount(view, h("div", { class: "card" }, emptyState("users", "Join a tribe first", text, browse, start)));
}

function deleteSection(event) {
  async function deleteEvent() {
    const warning = `“${event.title}” and everything attached to it will be deleted for everyone. This can't be undone.`;
    if (!(await confirmAction("Delete this event?", warning, "Delete event", true))) return;

    try {
      await api.deleteEvent(event.id);
      toast("Event deleted");
      go(`/tribes/${event.tribe_id}`);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  const button = h("button", { type: "button", class: "btn btn-danger", onclick: deleteEvent }, icon("trash"), "Delete event");
  return section("Delete event", "This removes the event, its packing list and its photos for everyone.", h("div", {}, button));
}

/** Draws the form: a new event when `eventId` is null, else an edit of that event. */
export async function renderEventForm(view, eventId, query = new URLSearchParams()) {
  const editing = Boolean(eventId);
  const [tribes, detail] = await Promise.all([api.tribes(), editing ? api.event(eventId) : Promise.resolve(null)]);
  const event = detail?.event || null;
  const myTribes = tribes.filter((tribe) => tribe.is_member);
  view.classList.add("medium");

  if (editing && !detail.can_manage) {
    cannotEdit(view, eventId);
    return;
  }
  if (!editing && !myTribes.length) {
    needsATribe(view);
    return;
  }

  /* ── The fields ───────────────────────────────── */

  const when = dateAndTimeInputs(event ? event.starts_at : nextSaturdayMorning());
  const requestedTribe = query.get("tribe");

  const tribeOptions = myTribes.map((tribe) => h("option", { value: tribe.id, selected: tribe.id === requestedTribe ? true : null }, tribe.name));
  const tribeSelect = h("select", { name: "tribe" }, tribeOptions);
  const title = h("input", { name: "title", maxlength: 120, placeholder: "e.g. Skyline Trail loop at Paradise", value: event?.title || "" });
  const date = h("input", { type: "date", value: when.date, required: true });
  const time = h("input", { type: "time", value: when.time, required: true, step: 300 });

  const titleField = field("Title", title);
  const dateField = field("Date", date);
  const timeField = field("Start time", time, { hint: Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ") });

  const places = locationsEditor({ meet: initialMeetingPoint(event, query), stops: detail?.stops || [] });
  const cover = picturePicker({ existingUrl: event?.cover_image ? pictureUrl(event.cover_image) : null });
  const description = markdownEditor({
    value: event?.description || "",
    maxLength: 8000,
    placeholder: DESCRIPTION_PLACEHOLDER,
    templates: EVENT_OUTLINES,
    details: describeForm,
  });

  /** The form so far as lines, for the model writing the description. */
  function describeForm() {
    const lines = [];
    const tribeName = editing ? event.tribe_name : tribeSelect.selectedOptions[0]?.textContent || "";

    if (title.value.trim()) lines.push(`Title: ${title.value.trim()}`);
    lines.push(`Tribe: ${tribeName}`);

    if (date.value) {
      const starts = new Date(`${date.value}T${time.value || "00:00"}`);
      const words = starts.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      lines.push(`Starts: ${words}`);
    }

    const where = places.peek();
    if (where.meet) lines.push(`Meeting point: ${where.meet.name}`);
    for (const stop of where.stops) {
      const note = stop.note ? ` (${stop.note})` : "";
      lines.push(`${PLACE_KINDS[stop.kind].label}: ${stop.name}${note}`);
    }

    return lines;
  }

  /** Puts a draft from the plan assistant into the form; returns what it filled. */
  function fillFromDraft(draft) {
    const filled = [];

    if (draft.title) {
      title.value = draft.title;
      titleField.setError(null);
      filled.push("title");
    }

    if (draft.description) {
      description.setValue(draft.description);
      filled.push("description");
    }

    if (draft.date) {
      date.value = draft.date;
      dateField.setError(null);
      filled.push("date");
    }

    if (draft.time) {
      time.value = draft.time;
      filled.push("time");
    }

    if (draft.meeting || draft.stops.length) {
      places.set({ meet: draft.meeting, stops: draft.stops });
      filled.push("places");
    }

    for (const element of [title, description.element, date, time, places.element]) {
      element.classList.remove("just-filled");
      void element.offsetWidth;
      element.classList.add("just-filled");
    }

    return filled;
  }

  /* ── The form ─────────────────────────────────── */

  const tribeRow = editing
    ? labelled("Tribe", h("div", { class: "text-2" }, event.tribe_name))
    : field("Tribe", tribeSelect, { hint: "Everyone in this tribe will see the event." });
  const descriptionHint = "Optional, but details help people decide, and help the model plan the packing list.";

  const submit = h("button", { type: "submit", class: "btn btn-primary" }, editing ? "Save changes" : "Create event");
  const cancel = h("a", { class: "btn btn-ghost", href: editing ? `#/events/${eventId}` : "#/events" }, "Cancel");

  const form = h("form", { class: "card", novalidate: true },
    section("Basics", "What's the plan? The description also helps the packing-list model suggest the right things.",
      tribeRow,
      titleField,
      labelled("Description", description.element, descriptionHint)),
    section("Date and time", "When should people be at the meeting point?", h("div", { class: "field-row" }, dateField, timeField)),
    wideSection("Where", WHERE_INTRO, places.element),
    section("Cover picture", "Shown at the top of the event and on its card. Without one, the card shows a map.", cover.element),
    editing ? deleteSection(event) : null,
    h("div", { class: "form-actions" }, cancel, submit));

  /* ── Saving ───────────────────────────────────── */

  /** Marks problems with the title and time; returns the first field to fix, or null. */
  function firstProblem() {
    let first = null;
    const flag = (wrapper, message, input) => {
      wrapper.setError(message);
      if (message && !first) first = input;
    };

    flag(titleField, title.value.trim() ? null : "Give the event a title", title);
    flag(dateField, date.value ? null : "Pick a date", date);
    flag(timeField, time.value ? null : "Pick a start time", time);

    const start = unixFromInputs(date.value, time.value);
    if (date.value && time.value && start < Date.now() / 1000 - 3600) {
      flag(dateField, "That's in the past", date);
    }

    return first;
  }

  function setSaving(saving) {
    submit.disabled = saving;

    if (saving) submit.replaceChildren(h("span", { class: "spinner" }), editing ? "Saving…" : "Creating…");
    else submit.replaceChildren(editing ? "Save changes" : "Create event");
  }

  async function save(submitted) {
    submitted.preventDefault();

    const problem = firstProblem();
    if (problem) {
      problem.focus();
      return;
    }

    const where = places.value();
    if (!where) return;

    const start = unixFromInputs(date.value, time.value);
    const fields = {
      title: title.value.trim(),
      description: description.value(),
      place_name: where.meet.name,
      lat: where.meet.lat,
      lng: where.meet.lng,
      stops: where.stops,
      starts_at: start,
      tz_offset_minutes: -new Date(start * 1000).getTimezoneOffset(),
    };

    setSaving(true);

    try {
      const saved = editing
        ? await api.updateEvent(eventId, fields)
        : await api.createEvent({ tribe_id: tribeSelect.value, ...fields });

      await saveCover(saved.id, cover.value());
      toast(editing ? "Changes saved" : "Event created", "success");
      go(`/events/${saved.id}`);
    } catch (error) {
      toast(error.message, "error");
      setSaving(false);
    }
  }

  form.addEventListener("submit", save);

  /* ── The page ─────────────────────────────────── */

  const heading = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, editing ? "Edit event" : "New event"), h("p", {}, editing ? event.title : "Plan an outing for your tribe.")));
  const assistant = editing ? null : planAssistant({ fill: fillFromDraft });

  mount(view, heading, assistant, form);
  places.start();

  if (!editing) title.focus();
}
