// A person's profile; your own can be edited here, and you sign out here.

import { api } from "../api.js";
import { skyline } from "../art.js";
import { h, mount, toast, avatar, busyButton } from "../ui.js";
import { session } from "../app.js";
import { eventCard, tribeCard } from "./tribes.js";

function editForm(person, onSaved) {
  const form = h("form", { class: "card stack" },
    h("h3", {}, "Edit profile"),
    h("label", {}, "Name", h("input", { name: "name", required: true, maxlength: 60, value: person.name })),
    h("label", {}, "Home area", h("input", { name: "home_area", maxlength: 80, value: person.home_area, placeholder: "Fremont, Seattle" })),
    h("label", {}, "About you", h("textarea", { name: "bio", rows: 3, maxlength: 500 }, person.bio)),
    h("button", { type: "submit", class: "button primary" }, "Save"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const updated = await api.updateMe({ name: data.get("name"), home_area: data.get("home_area"), bio: data.get("bio") });
      session.user = updated;
      toast("Saved", "success");
      onSaved();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  return form;
}

/** Draws a profile page. */
export async function renderProfile(view, userId) {
  const profile = await api.person(userId);
  const { person, tribes, events } = profile;
  const isMe = person.id === session.user.id;
  const editSlot = h("div");
  const upcoming = events.filter((event) => event.starts_at > Date.now() / 1000 - 6 * 3600);
  const past = events.filter((event) => event.starts_at <= Date.now() / 1000 - 6 * 3600);

  mount(view,
    h("section", { class: "page-hero compact sky-dawn" },
      h("div", { class: "page-hero-art", html: skyline("dawn") }),
      h("div", { class: "page-hero-inner" },
        h("div", { class: "hero-title-row" },
          avatar(person.name, 72),
          h("div", {},
            h("h1", {}, person.name),
            h("p", { class: "lead" }, [person.home_area, `${tribes.length} tribes`, `${past.length} outings`].filter(Boolean).join(" · ")))),
        isMe
          ? h("div", { class: "hero-actions" },
              h("button", { class: "button ghost", onclick: () => mount(editSlot, editForm(person, () => renderProfile(view, userId))) }, "Edit"),
              busyButton("Sign out", async () => {
                await api.logout();
                session.user = null;
                window.location.hash = "#/";
                window.dispatchEvent(new CustomEvent("signed-out"));
                window.location.reload();
              }, { class: "button ghost" }))
          : null)),
    editSlot,
    person.bio ? h("div", { class: "card prose" }, h("p", { class: "pre" }, person.bio)) : null,
    upcoming.length ? h("section", {}, h("h2", { class: "section-title" }, "Going to"), h("div", { class: "list" }, upcoming.map(eventCard))) : null,
    h("section", {}, h("h2", { class: "section-title" }, "Tribes"),
      tribes.length ? h("div", { class: "grid" }, tribes.map(tribeCard)) : h("p", { class: "muted" }, "No tribes yet.")),
    past.length ? h("section", {}, h("h2", { class: "section-title" }, "Been to"), h("div", { class: "list" }, past.map(eventCard))) : null,
  );
}
