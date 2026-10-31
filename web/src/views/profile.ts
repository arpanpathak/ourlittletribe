// A person's profile: who they are, where they're going, their tribes. Your own can be edited.

import { account, people } from "../api/client.js";
import type { Event, ProfilePage, User } from "../api/types.js";
import { heroScene } from "../art.js";
import { eventCard, tribeCard } from "../components/cards.js";
import { choosePictures, pictureProblem } from "../components/picture_picker.js";
import { h, mount } from "../dom.js";
import { count } from "../format.js";
import { icon, type IconName } from "../icons.js";
import { me, refreshHeader, setUser } from "../session.js";
import { field, tabBar } from "../ui/controls.js";
import { emptyState, errorMessage, toast } from "../ui/feedback.js";
import { dropdown, menuItem, type MenuEntry } from "../ui/menu.js";
import { openModal } from "../ui/modal.js";
import { avatar, pictureUrl } from "../ui/pictures.js";

/** The profile's tabs. */
type Tab = "upcoming" | "past" | "tribes";

/** How long after starting an event still counts as upcoming, seconds. */
const STILL_UPCOMING = 6 * 3600;

/** One of the person's two pictures, and how to change it. */
interface PictureSlot {
  /** What to call it in messages, such as "profile picture". */
  name: string;
  /** Uploads a new one. */
  upload: (file: File) => Promise<User>;
  /** Removes it. */
  remove: () => Promise<User>;
}

const AVATAR: PictureSlot = { name: "profile picture", upload: account.setAvatar, remove: account.removeAvatar };
const COVER: PictureSlot = { name: "cover", upload: account.setCover, remove: account.removeCover };

/** An empty tab: what to show when it has nothing. */
interface EmptyTab {
  /** Its icon. */
  icon: IconName;
  /** The headline. */
  title: string;
  /** A line under it. */
  text: string | null;
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function joinedLine(person: User): string {
  const when = new Date(person.created_at * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `Joined ${when}`;
}

/** Asks for one picture and uploads it; returns the updated person, or null. */
async function replacePicture(slot: PictureSlot): Promise<User | null> {
  const [file] = await choosePictures(false);
  if (!file) return null;

  const problem = pictureProblem(file);
  if (problem) {
    toast(problem, "error");
    return null;
  }

  toast(`Uploading your ${slot.name}…`);
  try {
    const updated = await slot.upload(file);
    toast(`${capitalised(slot.name)} updated`, "success");
    return updated;
  } catch (error) {
    toast(errorMessage(error), "error");
    return null;
  }
}

/** The edit dialog; resolves with the saved person, or undefined if cancelled. */
function editProfile(person: User): Promise<User | undefined> {
  const name = h("input", { maxlength: 60, value: person.name });
  const area = h("input", { maxlength: 80, value: person.home_area, placeholder: "e.g. Fremont, Seattle" });
  const bio = h("textarea", { rows: 4, maxlength: 500, placeholder: "A line or two about you" }, person.bio);
  const nameField = field("Name", name);

  const save = async (button: HTMLButtonElement, close: (value?: User) => void) => {
    if (!name.value.trim()) {
      nameField.setError("Enter your name");
      return;
    }

    button.disabled = true;
    try {
      close(await account.updateProfile({ name: name.value.trim(), home_area: area.value.trim(), bio: bio.value.trim() }));
    } catch (error) {
      toast(errorMessage(error), "error");
      button.disabled = false;
    }
  };

  return openModal<User>({
    title: "Edit profile",
    build: () => h("div", { class: "stack" }, nameField.element, field("Home area", area).element, field("About you", bio, { hint: "Up to 500 characters." }).element),
    actions: (close) => {
      const saveButton: HTMLButtonElement = h("button", { type: "button", class: "btn btn-primary", onclick: () => void save(saveButton, close) }, "Save");
      return [h("button", { type: "button", class: "btn", onclick: () => close() }, "Cancel"), saveButton];
    },
  });
}

/** The profile page. */
class Profile {
  private readonly body = h("div", { class: "tab-body" });
  private tab: Tab = "upcoming";
  private readonly upcoming: Event[];
  private readonly past: Event[];
  private readonly isMe: boolean;

  constructor(private readonly view: HTMLElement, private readonly page: ProfilePage) {
    const cutoff = Date.now() / 1000 - STILL_UPCOMING;
    this.upcoming = page.events.filter((event) => event.starts_at > cutoff).sort((first, second) => first.starts_at - second.starts_at);
    this.past = page.events.filter((event) => event.starts_at <= cutoff);
    this.isMe = page.person.id === me().id;

    this.draw();
  }

  /** Records the change and draws the page again. */
  private async changed(updated: User | null | undefined): Promise<void> {
    if (!updated) return;

    setUser(updated);
    refreshHeader();
    await renderProfile(this.view, updated.id);
  }

  private pictureMenu(slot: PictureSlot, trigger: HTMLElement, hasOne: boolean): HTMLElement {
    const entries = (): MenuEntry[] => {
      const upload = menuItem("upload", hasOne ? "Upload a new picture" : "Upload a picture", () => void replacePicture(slot).then((user) => this.changed(user)));
      const remove = menuItem("trash", `Remove ${slot.name}`, () => void slot.remove().then((user) => this.changed(user)), { class: "menu-danger" });
      return hasOne ? [upload, remove] : [upload];
    };
    return dropdown(trigger, entries);
  }

  private coverArea(): HTMLElement {
    const { person } = this.page;
    const hasCover = Boolean(person.cover_image);
    const picture = person.cover_image ? h("img", { src: pictureUrl(person.cover_image), alt: "" }) : null;

    const trigger = h("button", { type: "button", class: "btn btn-sm btn-overlay" }, icon("camera", "sm"), hasCover ? "Change cover" : "Add a cover");
    const menu = this.isMe ? h("div", { class: "cover-actions" }, this.pictureMenu(COVER, trigger, hasCover)) : null;

    return h("div", { class: "cover profile-cover", html: hasCover ? undefined : heroScene(["cy", "ada", "bo"]) }, picture, menu);
  }

  private identity(): HTMLElement {
    const { person, tribes } = this.page;

    const avatarTrigger = h("button", { type: "button", class: "btn btn-icon avatar-edit", "aria-label": "Change profile picture", title: "Change profile picture" }, icon("camera", "sm"));
    const avatarMenu = this.isMe ? this.pictureMenu(AVATAR, avatarTrigger, Boolean(person.avatar)) : null;

    const facts = h("div", { class: "facts" },
      person.home_area ? h("span", {}, icon("pin"), person.home_area) : null,
      h("span", {}, icon("users"), count(tribes.length, "tribe")),
      h("span", {}, icon("calendar"), joinedLine(person)));

    const editButton = this.isMe
      ? h("button", { type: "button", class: "btn", onclick: () => void editProfile(person).then((user) => this.changed(user)) }, icon("edit"), "Edit profile")
      : null;

    return h("div", { class: "profile-main" },
      h("div", { class: "profile-avatar" }, avatar(person, 112), avatarMenu),
      h("div", { class: "grow stack profile-text" }, h("h1", {}, person.name), facts, person.bio ? h("p", { class: "text-2 pre" }, person.bio) : null),
      editButton);
  }

  private emptyFor(tab: Tab): EmptyTab {
    switch (tab) {
      case "upcoming":
        return { icon: "calendar", title: "No upcoming plans", text: this.isMe ? "Events you say you're going to show up here." : null };
      case "past":
        return { icon: "clock", title: "No past outings yet", text: null };
      case "tribes":
        return { icon: "users", title: "No tribes yet", text: this.isMe ? "Join a tribe to see its plans." : null };
    }
  }

  private tabContent(): HTMLElement | null {
    switch (this.tab) {
      case "upcoming":
        return this.upcoming.length ? h("div", { class: "grid-cards" }, this.upcoming.map(eventCard)) : null;
      case "past":
        return this.past.length ? h("div", { class: "grid-cards" }, this.past.map(eventCard)) : null;
      case "tribes":
        return this.page.tribes.length ? h("div", { class: "grid-cards" }, this.page.tribes.map((tribe) => tribeCard(tribe))) : null;
    }
  }

  private drawBody(): void {
    const content = this.tabContent();
    if (content) {
      mount(this.body, content);
      return;
    }

    const empty = this.emptyFor(this.tab);
    const browse = this.tab === "tribes" && this.isMe ? h("a", { class: "btn btn-primary", href: "#/tribes" }, "Browse tribes") : null;
    mount(this.body, h("div", { class: "card" }, emptyState(empty.icon, empty.title, empty.text, ...(browse ? [browse] : []))));
  }

  private draw(): void {
    const choices = [
      { value: "upcoming" as const, label: "Upcoming", count: this.upcoming.length },
      { value: "past" as const, label: "Past", count: this.past.length },
      { value: "tribes" as const, label: "Tribes", count: this.page.tribes.length },
    ];
    const tabs = tabBar<Tab>(choices, this.tab, (tab) => {
      this.tab = tab;
      this.drawBody();
    });

    mount(this.view, h("section", { class: "card profile-card" }, this.coverArea(), this.identity()), h("div", {}, tabs, this.body));
    this.drawBody();
  }
}

/** Draws a profile page. */
export async function renderProfile(view: HTMLElement, userId: string): Promise<void> {
  new Profile(view, await people.profile(userId));
}
