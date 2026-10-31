// Planning a new event, or editing one: what, when, where on the map, and a cover picture.

import { api } from "../api.js";
import { h, mount, icon, field, toast, emptyState, confirmAction, dateAndTimeInputs, unixFromInputs, pictureUrl } from "../ui.js";
import { go } from "../app.js";
import { placePicker } from "../components/place_picker.js";
import { picturePicker } from "../components/picture_picker.js";

function nextSaturdayMorning() {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  date.setHours(9, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function section(title, text, ...body) {
  return h("div", { class: "form-section" },
    h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text)),
    h("div", { class: "form-section-body" }, body));
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

/** Draws the form: a new event when `eventId` is null, else an edit of that event. */
export async function renderEventForm(view, eventId, query = new URLSearchParams()) {
  const editing = Boolean(eventId);
  const [tribes, detail] = await Promise.all([api.tribes(), editing ? api.event(eventId) : Promise.resolve(null)]);
  const event = detail?.event || null;
  const myTribes = tribes.filter((tribe) => tribe.is_member);
  view.classList.add("narrow");

  if (editing && !detail.can_manage) {
    mount(view, emptyState("alert", "You can't edit this event", "Only its planner and the tribe's organizers can.", h("a", { class: "btn", href: `#/events/${eventId}` }, "Back to the event")));
    return;
  }
  if (!editing && !myTribes.length) {
    mount(view, h("div", { class: "card" }, emptyState("users", "Join a tribe first", "Events belong to a tribe, so everyone in it can see the plan. Join one, or start your own.",
      h("a", { class: "btn", href: "#/tribes" }, "Browse tribes"),
      h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe"))));
    return;
  }

  const startsAt = event ? event.starts_at : nextSaturdayMorning();
  const when = dateAndTimeInputs(startsAt);
  const requestedTribe = query.get("tribe");

  const tribeSelect = h("select", { name: "tribe" }, myTribes.map((tribe) =>
    h("option", { value: tribe.id, selected: tribe.id === requestedTribe ? true : null }, tribe.name)));
  const title = h("input", { name: "title", maxlength: 120, placeholder: "e.g. Skyline Trail loop at Paradise", value: event?.title || "" });
  const description = h("textarea", { name: "description", rows: 6, maxlength: 4000, placeholder: "Distance, elevation gain, pace, what to expect, food plans, dogs or kids, when you'll head back…" }, event?.description || "");
  const date = h("input", { type: "date", value: when.date, required: true });
  const time = h("input", { type: "time", value: when.time, required: true, step: 300 });

  const titleField = field("Title", title);
  const dateField = field("Date", date);
  const timeField = field("Start time", time, { hint: Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ") });

  const initialPlace = event
    ? { name: event.place_name, detail: "", lat: event.lat, lng: event.lng }
    : query.get("lat") && query.get("lng")
      ? { name: query.get("name") || "", detail: "", lat: Number(query.get("lat")), lng: Number(query.get("lng")) }
      : null;
  const place = placePicker({ initial: initialPlace, label: "Meeting point" });
  const cover = picturePicker({ existingUrl: event?.cover_image ? pictureUrl(event.cover_image) : null });

  const submit = h("button", { type: "submit", class: "btn btn-primary" }, editing ? "Save changes" : "Create event");
  const form = h("form", { class: "card", novalidate: true },
    section("Basics", "What's the plan? The description also helps the packing-list model suggest the right things.",
      editing
        ? h("div", { class: "field" }, h("span", { class: "field-label" }, "Tribe"), h("div", { class: "text-2" }, event.tribe_name))
        : field("Tribe", tribeSelect, { hint: "Everyone in this tribe will see the event." }),
      titleField,
      field("Description", description, { hint: "Optional, but details help people decide and help the model plan." })),
    section("Date and time", "When should people be at the meeting point?",
      h("div", { class: "field-row" }, dateField, timeField)),
    section("Location", "Search for a place, use your location, or click the map. Drag the pin to fine-tune.", place.element),
    section("Cover picture", "Shown at the top of the event and on its card. Without one, the card shows a map.", cover.element),
    editing
      ? section("Delete event", "This removes the event, its packing list and its photos for everyone.",
          h("div", {}, h("button", {
            type: "button",
            class: "btn btn-danger",
            onclick: async () => {
              if (!(await confirmAction("Delete this event?", `“${event.title}” and everything attached to it will be deleted for everyone. This can't be undone.`, "Delete event", true))) return;
              try {
                await api.deleteEvent(eventId);
                toast("Event deleted");
                go(`/tribes/${event.tribe_id}`);
              } catch (error) {
                toast(error.message, "error");
              }
            },
          }, icon("trash"), "Delete event")))
      : null,
    h("div", { class: "form-actions" },
      h("a", { class: "btn btn-ghost", href: editing ? `#/events/${eventId}` : "#/events" }, "Cancel"),
      submit));

  form.addEventListener("submit", async (submitted) => {
    submitted.preventDefault();
    let firstProblem = null;
    const flag = (wrapper, message, focusTarget) => {
      wrapper.setError(message);
      if (message && !firstProblem) firstProblem = focusTarget;
    };
    flag(titleField, title.value.trim() ? null : "Give the event a title", title);
    const start = unixFromInputs(date.value, time.value);
    flag(dateField, date.value ? null : "Pick a date", date);
    flag(timeField, time.value ? null : "Pick a start time", time);
    if (date.value && time.value && start < Date.now() / 1000 - 3600) flag(dateField, "That's in the past", date);
    const location = place.value();
    if (!location) place.showError("Choose where to meet: search, or click the map");
    if (firstProblem) firstProblem.focus();
    if (firstProblem || !location) return;
    const fields = {
      title: title.value.trim(),
      description: description.value.trim(),
      place_name: location.name,
      lat: location.lat,
      lng: location.lng,
      starts_at: start,
      tz_offset_minutes: -new Date(start * 1000).getTimezoneOffset(),
    };
    submit.disabled = true;
    submit.replaceChildren(h("span", { class: "spinner" }), editing ? "Saving…" : "Creating…");
    try {
      const saved = editing
        ? await api.updateEvent(eventId, fields)
        : await api.createEvent({ tribe_id: tribeSelect.value, ...fields });
      await saveCover(saved.id, cover.value());
      toast(editing ? "Changes saved" : "Event created", "success");
      go(`/events/${saved.id}`);
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
      submit.replaceChildren(editing ? "Save changes" : "Create event");
    }
  });

  mount(view,
    h("div", { class: "page-head" },
      h("div", {},
        h("h1", {}, editing ? "Edit event" : "New event"),
        h("p", {}, editing ? event.title : "Plan an outing for your tribe."))),
    form);
  place.start();
  if (!editing) title.focus();
}
