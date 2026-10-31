// A person's profile: who they are, where they're going, their tribes. Your own can be edited.

import { api } from "../api.js";
import { h, mount, icon, avatar, toast, tabBar, emptyState, field, openModal, dropdown, menuItem, pictureUrl } from "../ui.js";
import { heroScene } from "../art.js";
import { choosePictures, pictureProblem } from "../components/picture_picker.js";
import { session, refreshHeader } from "../app.js";
import { eventCard, tribeCard } from "../components/cards.js";

function editProfile(person) {
  const name = h("input", { maxlength: 60, value: person.name });
  const area = h("input", { maxlength: 80, value: person.home_area, placeholder: "e.g. Fremont, Seattle" });
  const bio = h("textarea", { rows: 4, maxlength: 500, placeholder: "A line or two about you" }, person.bio);
  const nameField = field("Name", name);
  return openModal({
    title: "Edit profile",
    build: () => h("div", { class: "stack" }, nameField, field("Home area", area), field("About you", bio, { hint: "Up to 500 characters." })),
    actions: (close) => {
      const save = h("button", {
        type: "button",
        class: "btn btn-primary",
        onclick: async () => {
          if (!name.value.trim()) {
            nameField.setError("Enter your name");
            return;
          }
          save.disabled = true;
          try {
            close(await api.updateMe({ name: name.value.trim(), home_area: area.value.trim(), bio: bio.value.trim() }));
          } catch (error) {
            toast(error.message, "error");
            save.disabled = false;
          }
        },
      }, "Save");
      return [h("button", { type: "button", class: "btn", onclick: () => close(undefined) }, "Cancel"), save];
    },
  });
}

/** Asks for one picture and uploads it with `upload(file)`; returns the updated person, or null. */
async function replacePicture(upload, what) {
  const [file] = await choosePictures(false);
  if (!file) return null;
  const problem = pictureProblem(file);
  if (problem) {
    toast(problem, "error");
    return null;
  }
  toast(`Uploading your ${what}…`);
  try {
    const updated = await upload(file);
    toast(`${what.charAt(0).toUpperCase()}${what.slice(1)} updated`, "success");
    return updated;
  } catch (error) {
    toast(error.message, "error");
    return null;
  }
}

/** Draws a profile page. */
export async function renderProfile(view, userId) {
  const { person, tribes, events } = await api.person(userId);
  const isMe = person.id === session.user.id;
  const cutoff = Date.now() / 1000 - 6 * 3600;
  const upcoming = events.filter((event) => event.starts_at > cutoff).sort((a, b) => a.starts_at - b.starts_at);
  const past = events.filter((event) => event.starts_at <= cutoff);
  let tab = "upcoming";
  const body = h("div", { style: "margin-top:24px" });

  function drawBody() {
    const lists = {
      upcoming: [upcoming, "calendar", "No upcoming plans", isMe ? "Events you say you're going to show up here." : null],
      past: [past, "clock", "No past outings yet", null],
    };
    if (tab === "tribes") {
      mount(body, tribes.length
        ? h("div", { class: "grid-cards" }, tribes.map((tribe) => tribeCard(tribe)))
        : h("div", { class: "card" }, emptyState("users", "No tribes yet", isMe ? "Join a tribe to see its plans." : null,
            isMe ? h("a", { class: "btn btn-primary", href: "#/tribes" }, "Browse tribes") : null)));
      return;
    }
    const [list, iconName, title, text] = lists[tab];
    mount(body, list.length
      ? h("div", { class: "grid-cards" }, list.map(eventCard))
      : h("div", { class: "card" }, emptyState(iconName, title, text)));
  }

  async function changed(updated) {
    if (!updated) return;
    session.user = updated;
    refreshHeader();
    await renderProfile(view, userId);
  }

  const coverMenu = isMe
    ? h("div", { class: "cover-actions" }, dropdown(
        h("button", { type: "button", class: "btn btn-sm btn-overlay" }, icon("camera", "sm"), person.cover_image ? "Change cover" : "Add a cover"),
        () => [
          menuItem("upload", "Upload a picture", async () => changed(await replacePicture(api.setProfileCover, "cover"))),
          person.cover_image ? menuItem("trash", "Remove cover", async () => changed(await api.removeProfileCover()), { class: "menu-danger" }) : null,
        ].filter(Boolean)))
    : null;
  const avatarMenu = isMe
    ? dropdown(
        h("button", { type: "button", class: "btn btn-icon avatar-edit", "aria-label": "Change profile picture", title: "Change profile picture" }, icon("camera", "sm")),
        () => [
          menuItem("upload", person.avatar ? "Upload a new picture" : "Upload a picture", async () => changed(await replacePicture(api.setAvatar, "profile picture"))),
          person.avatar ? menuItem("trash", "Remove picture", async () => changed(await api.removeAvatar()), { class: "menu-danger" }) : null,
        ].filter(Boolean))
    : null;

  mount(view,
    h("section", { class: "card profile-card" },
      h("div", { class: "cover profile-cover", html: person.cover_image ? null : heroScene({ crew: ["cy", "ada", "bo"] }) },
        person.cover_image ? h("img", { src: pictureUrl(person.cover_image), alt: "" }) : null,
        coverMenu),
      h("div", { class: "profile-main" },
        h("div", { class: "profile-avatar" }, avatar(person.name, 112, person.avatar), avatarMenu),
        h("div", { class: "grow stack", style: "gap:6px" },
          h("h1", {}, person.name),
          h("div", { class: "facts" },
            person.home_area ? h("span", {}, icon("pin"), person.home_area) : null,
            h("span", {}, icon("users"), `${tribes.length} ${tribes.length === 1 ? "tribe" : "tribes"}`),
            h("span", {}, icon("calendar"), `Joined ${new Date(person.created_at * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`)),
          person.bio ? h("p", { class: "text-2 pre", style: "margin-top:6px" }, person.bio) : null),
        isMe
          ? h("button", {
              type: "button",
              class: "btn",
              onclick: async () => {
                const updated = await editProfile(person);
                if (!updated) return;
                session.user = updated;
                refreshHeader();
                toast("Profile saved", "success");
                renderProfile(view, userId);
              },
            }, icon("edit"), "Edit profile")
          : null)),
    h("div", {},
      tabBar([["upcoming", "Upcoming", upcoming.length], ["past", "Past", past.length], ["tribes", "Tribes", tribes.length]], tab, (value) => {
        tab = value;
        drawBody();
      }),
      body));
  drawBody();
}
