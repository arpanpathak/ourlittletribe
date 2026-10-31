// One tribe: its cover, what it's planning, what it did, and who's in it.

import { drafts, tribes } from "../api/client.js";
import type { Member, TribeDetail } from "../api/types.js";
import { eventCard, personTile } from "../components/cards.js";
import { choosePictures, pictureProblem } from "../components/picture_picker.js";
import { coverFile } from "../cover_art.js";
import { h, mount } from "../dom.js";
import { count, relativeTime } from "../format.js";
import { icon } from "../icons.js";
import { renderMarkdown } from "../markdown.js";
import { me, replaceRoute } from "../session.js";
import { actionButton, copyText, tabBar } from "../ui/controls.js";
import { emptyState, errorMessage, toast } from "../ui/feedback.js";
import { dropdown, menuItem, type MenuEntry } from "../ui/menu.js";
import { confirmAction } from "../ui/modal.js";
import { tribeCover } from "../ui/pictures.js";

/** The tribe page's tabs. */
type Tab = "events" | "past" | "members" | "about";

const TABS: Tab[] = ["events", "past", "members", "about"];

function parseTab(text: string | null): Tab {
  return TABS.find((tab) => tab === text) ?? "events";
}

function memberLine(member: Member): string {
  switch (member.role) {
    case "organizer":
      return "Organizer";
    case "member":
      return `Joined ${relativeTime(member.joined_at)}`;
  }
}

/** The tribe page, redrawn whenever the tribe changes. */
class TribePage {
  /** The cover, name and buttons. */
  private readonly heroSlot = h("div", { class: "stack-lg" });
  /** The tab bar. */
  private readonly tabsSlot = h("div");
  /** The open tab's content. */
  private readonly body = h("div", { class: "tab-body" });

  constructor(view: HTMLElement, private detail: TribeDetail, private tab: Tab) {
    mount(view, this.heroSlot, h("div", {}, this.tabsSlot, this.body));
    this.draw();
  }

  private get id(): string {
    return this.detail.tribe.id;
  }

  private canManage(): boolean {
    return this.detail.tribe.is_organizer || me().is_admin;
  }

  private async refresh(): Promise<void> {
    this.detail = await tribes.detail(this.id);
    this.draw();
  }

  /* ── Actions ────────────────────────────────────── */

  private async changeCover(): Promise<void> {
    const [file] = await choosePictures(false);
    if (!file) return;

    const problem = pictureProblem(file);
    if (problem) throw new Error(problem);

    await tribes.setCover(this.id, file);
    toast("Cover updated", "success");
    await this.refresh();
  }

  private async join(): Promise<void> {
    await tribes.join(this.id);
    toast(`Welcome to ${this.detail.tribe.name}!`, "success");
    await this.refresh();
  }

  private async leave(): Promise<void> {
    const { name } = this.detail.tribe;
    const sure = await confirmAction("Leave this tribe?", `You'll stop seeing ${name}'s plans in your feed. You can join again any time.`, "Leave tribe", true);
    if (!sure) return;

    try {
      await tribes.leave(this.id);
      toast(`You left ${name}`);
      await this.refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  /* ── The hero ───────────────────────────────────── */

  /** Has the model choose a scene for the tribe, draws it, and makes it the cover. */
  private async drawCover(): Promise<void> {
    const { name, description, home_area: place } = this.detail.tribe;
    const design = await drafts.cover({ subject: "tribe", title: name, description, place, when: "" });

    await tribes.setCover(this.id, await coverFile(design, "tribe-cover"));
    toast("New cover drawn", "success");
    await this.refresh();
  }

  private coverButtons(): HTMLElement | null {
    if (!this.canManage()) return null;

    const label = this.detail.tribe.cover_image ? "Change cover" : "Add cover";
    const change = actionButton([icon("image", "sm"), label], () => this.changeCover(), { class: "btn btn-sm btn-overlay" });
    const draw = actionButton([icon("sparkles", "sm"), "Draw one with AI"], () => this.drawCover(), { class: "btn btn-sm btn-overlay" });
    return h("div", { class: "cover-actions" }, change, draw);
  }

  private membershipButton(): HTMLElement {
    const { tribe } = this.detail;
    if (!tribe.is_member) return actionButton([icon("plus"), "Join tribe"], () => this.join(), { class: "btn btn-primary" });

    const trigger = h("button", { type: "button", class: "btn btn-soft" }, icon("check"), tribe.is_organizer ? "Organizer" : "Member", icon("chevronDown", "sm"));
    return dropdown(trigger, () => [menuItem("logout", "Leave tribe", () => void this.leave(), { class: "menu-danger" })]);
  }

  private moreMenu(): HTMLElement {
    const entries = (): MenuEntry[] => {
      const copy = menuItem("link", "Copy link", () => void copyText(window.location.href.split("?")[0] ?? ""));
      const edit = menuItem("edit", "Edit tribe", null, { href: `#/tribes/${this.id}/edit` });
      return this.canManage() ? [copy, edit] : [copy];
    };
    return dropdown(h("button", { type: "button", class: "btn btn-icon", "aria-label": "More actions" }, icon("more")), entries);
  }

  private drawHero(): void {
    const { tribe } = this.detail;

    const facts = h("div", { class: "facts" },
      tribe.home_area ? h("span", {}, icon("pin"), tribe.home_area) : null,
      h("span", {}, icon("users"), count(tribe.member_count, "member")));
    const identity = h("div", { class: "tribe-identity" },
      h("div", { class: "thumb" }, tribeCover({ ...tribe, cover_image: null })),
      h("div", { class: "tribe-title" }, h("h1", {}, tribe.name), facts));

    const planButton = tribe.is_member ? h("a", { class: "btn btn-primary", href: `#/events/new?tribe=${tribe.id}` }, icon("plus"), "Plan an event") : null;
    const actions = h("div", { class: "hero-actions" }, planButton, this.membershipButton(), this.moreMenu());

    mount(this.heroSlot,
      h("div", { class: "hero-cover-wrap" }, tribeCover(tribe, { size: "large", className: "hero-cover" }), this.coverButtons()),
      h("div", { class: "hero-head" }, identity, actions));
  }

  /* ── The tabs ───────────────────────────────────── */

  private upcomingTab(): HTMLElement {
    const { tribe, events } = this.detail;
    if (events.length) return h("div", { class: "grid-cards" }, events.map(eventCard));

    const empty = tribe.is_member
      ? emptyState("calendar", "Nothing planned yet", "Plan the next outing and everyone in the tribe will see it.", h("a", { class: "btn btn-primary", href: `#/events/new?tribe=${tribe.id}` }, icon("plus"), "Plan an event"))
      : emptyState("calendar", "Nothing planned yet", "Join the tribe to plan outings with it.");
    return h("div", { class: "card" }, empty);
  }

  private pastTab(): HTMLElement {
    const past = this.detail.past_events;
    if (past.length) return h("div", { class: "grid-cards" }, past.map(eventCard));
    return h("div", { class: "card" }, emptyState("clock", "No past events", "Outings show up here after they happen, with their photos."));
  }

  private membersTab(): HTMLElement {
    const tiles = this.detail.members.map((member) => personTile({ id: member.user_id, name: member.name, avatar: member.avatar, line: memberLine(member) }));
    return h("div", { class: "card" }, h("div", { class: "card-body" }, h("div", { class: "people-grid" }, tiles)));
  }

  private aboutTab(): HTMLElement {
    const { description } = this.detail.tribe;
    const editButton = this.canManage() ? h("a", { class: "btn btn-ghost btn-sm", href: `#/tribes/${this.id}/edit` }, icon("edit", "sm"), "Edit") : null;
    const text = description ? renderMarkdown(description) : h("p", { class: "muted" }, "No description yet.");

    return h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", {}, "About"), editButton), h("div", { class: "card-body" }, text));
  }

  private drawBody(): void {
    switch (this.tab) {
      case "events":
        mount(this.body, this.upcomingTab());
        break;
      case "past":
        mount(this.body, this.pastTab());
        break;
      case "members":
        mount(this.body, this.membersTab());
        break;
      case "about":
        mount(this.body, this.aboutTab());
        break;
    }
  }

  private openTab(tab: Tab): void {
    this.tab = tab;
    replaceRoute(`/tribes/${this.id}${tab === "events" ? "" : `?tab=${tab}`}`);
    this.drawBody();
  }

  private draw(): void {
    const { events, past_events: past, members } = this.detail;
    const choices = [
      { value: "events" as const, label: "Upcoming", count: events.length },
      { value: "past" as const, label: "Past", count: past.length },
      { value: "members" as const, label: "Members", count: members.length },
      { value: "about" as const, label: "About" },
    ];

    this.drawHero();
    mount(this.tabsSlot, tabBar<Tab>(choices, this.tab, (tab) => this.openTab(tab)));
    this.drawBody();
  }
}

/** Draws the tribe page, opening the tab named in the address. */
export async function renderTribe(view: HTMLElement, tribeId: string, tab: string | null): Promise<void> {
  const detail = await tribes.detail(tribeId);
  new TribePage(view, detail, parseTab(tab));
}
