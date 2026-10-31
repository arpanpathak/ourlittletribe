// Starting a tribe, or editing one: name, area, description and a cover picture.

import { api } from "../api.js";
import { h, mount, field, toast, emptyState, pictureUrl } from "../ui.js";
import { go, session } from "../app.js";
import { picturePicker } from "../components/picture_picker.js";
import { markdownEditor } from "../components/markdown_editor.js";

function section(title, text, ...body) {
  return h("div", { class: "form-section" },
    h("div", { class: "form-section-intro" }, h("h3", {}, title), h("p", {}, text)),
    h("div", { class: "form-section-body" }, body));
}

/** Draws the form: a new tribe when `tribeId` is null, else an edit of that tribe. */
export async function renderTribeForm(view, tribeId) {
  const editing = Boolean(tribeId);
  const detail = editing ? await api.tribe(tribeId) : null;
  const me = session.user;
  const tribe = detail?.tribe || null;
  view.classList.add("narrow");
  if (editing && !tribe.is_organizer && !me.is_admin) {
    mount(view, emptyState("alert", "You can't edit this tribe", "Only its organizers can.", h("a", { class: "btn", href: `#/tribes/${tribeId}` }, "Back to the tribe")));
    return;
  }

  const name = h("input", { maxlength: 80, placeholder: "e.g. Cascade Morning Walkers", value: tribe?.name || "" });
  const area = h("input", { maxlength: 80, placeholder: "e.g. Ballard, Seattle", value: tribe?.home_area || "" });
  const description = markdownEditor({
    value: tribe?.description || "",
    maxLength: 4000,
    rows: 6,
    placeholder: "What you do, how often, who it's for. Easy weekend hikes, dogs welcome, coffee after.",
    templates: [["About a tribe", "## What we do\n\n\n## How often\n\n\n## Who it's for\n- \n"]],
    details: () => ["This is a tribe: a group that plans outings together.", `Name: ${name.value.trim() || "not named yet"}`, area.value.trim() ? `Home area: ${area.value.trim()}` : "Home area: not given"],
  });
  const nameField = field("Name", name);
  const cover = picturePicker({ existingUrl: tribe?.cover_image ? pictureUrl(tribe.cover_image) : null });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, editing ? "Save changes" : "Create tribe");

  const form = h("form", { class: "card", novalidate: true },
    section("About the tribe", "This is what people see when they browse tribes.",
      nameField,
      field("Home area", area, { hint: "Where you usually meet. Optional." }),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Description"), description.element)),
    section("Cover picture", "Shown at the top of the tribe's page and on its card.", cover.element),
    h("div", { class: "form-actions" },
      h("a", { class: "btn btn-ghost", href: editing ? `#/tribes/${tribeId}` : "#/tribes" }, "Cancel"),
      submit));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!name.value.trim()) {
      nameField.setError("Give the tribe a name");
      name.focus();
      return;
    }
    nameField.setError(null);
    submit.disabled = true;
    submit.replaceChildren(h("span", { class: "spinner" }), editing ? "Saving…" : "Creating…");
    const fields = { name: name.value.trim(), home_area: area.value.trim(), description: description.value() };
    try {
      const saved = editing ? await api.updateTribe(tribeId, fields) : await api.createTribe(fields);
      const change = cover.value();
      try {
        if (change?.file) await api.setTribeCover(saved.id, change.file);
        else if (change?.removed) await api.removeTribeCover(saved.id);
      } catch (error) {
        toast(`Saved, but the cover picture wasn't: ${error.message}`, "error");
      }
      toast(editing ? "Changes saved" : `${saved.name} is ready`, "success");
      go(`/tribes/${saved.id}`);
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
      submit.replaceChildren(editing ? "Save changes" : "Create tribe");
    }
  });

  mount(view,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, editing ? "Edit tribe" : "New tribe"), h("p", {}, editing ? tribe.name : "Start a group for the people you get outside with."))),
    form);
  if (!editing) name.focus();
}
