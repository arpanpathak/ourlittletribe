// One event: the hero with its cover and buttons, and four tabs: overview,
// packing list, getting there, and photos. Each tab lives in its own module.

import { drafts, events } from "../../api/client.js";
import type { EventDetail } from "../../api/types.js";
import { choosePictures, pictureProblem } from "../../components/picture_picker.js";
import { coverFile } from "../../cover_art.js";
import { h, mount } from "../../dom.js";
import { count, formatLongDay, formatTime } from "../../format.js";
import { icon } from "../../icons.js";
import { go, me, replaceRoute } from "../../session.js";
import { actionButton, tabBar } from "../../ui/controls.js";
import { errorMessage, toast } from "../../ui/feedback.js";
import { dropdown, menuItem, type MenuEntry } from "../../ui/menu.js";
import { confirmAction } from "../../ui/modal.js";
import { eventCover } from "../../ui/pictures.js";
import { downloadCalendarFile, share } from "./calendar.js";
import { gettingThereTab } from "./getting_there.js";
import { overviewTab } from "./overview.js";
import { packingTab } from "./packing.js";
import { photosTab } from "./photos.js";
import { tripDirections } from "./places.js";
import { TABS, type EventScreen, type Tab, type TabView } from "./screen.js";

/** How long after its start an event counts as over, seconds. */
const OVER_AFTER = 6 * 3600;

function parseTab(text: string | null): Tab {
  return TABS.find((tab) => tab === text) ?? "overview";
}

/** The event page. */
class EventPage implements EventScreen {
  readonly me = me();

  private readonly heroSlot = h("div", { class: "stack-lg" });
  private readonly tabsSlot = h("div");
  private readonly bodySlot = h("div");

  constructor(view: HTMLElement, public detail: EventDetail, private tab: Tab) {
    mount(view, this.heroSlot, h("div", {}, this.tabsSlot, this.bodySlot));
    this.drawHero();
    this.drawTabs();
  }

  private get id(): string {
    return this.detail.event.id;
  }

  /* ── What tabs ask for ──────────────────────────── */

  async reload(): Promise<void> {
    this.detail = await events.detail(this.id);
    this.drawHero();
    this.drawTabs();
  }

  update(change: (detail: EventDetail) => void): void {
    change(this.detail);
    this.drawTabs();
  }

  openTab(tab: Tab): void {
    this.selectTab(tab);
    this.tabsSlot.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Switches tab where the person already is, as the tab bar does. */
  private selectTab(tab: Tab): void {
    this.tab = tab;
    replaceRoute(`/events/${this.id}${tab === "overview" ? "" : `?tab=${tab}`}`);
    this.drawTabs();
  }

  /* ── Actions ────────────────────────────────────── */

  private async uploadCover(): Promise<void> {
    const [file] = await choosePictures(false);
    if (!file) return;

    const problem = pictureProblem(file);
    if (problem) throw new Error(problem);

    await events.setCover(this.id, file);
    toast("Cover updated", "success");
    await this.reload();
  }

  private async drawCover(): Promise<void> {
    const { event, stops } = this.detail;
    const venue = stops.find((stop) => stop.kind === "venue");
    const when = new Date(event.starts_at * 1000).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const design = await drafts.cover({ subject: "event", title: event.title, description: event.description, place: venue?.name ?? event.meeting_point.name, when });
    await events.setCover(this.id, await coverFile(design, "event-cover"));
    toast("New cover drawn", "success");
    await this.reload();
  }

  private async removeCover(): Promise<void> {
    await events.removeCover(this.id);
    await this.reload();
  }

  private async setGoing(going: boolean): Promise<void> {
    await events.setRsvp(this.id, going ? "going" : "not_going");
    toast(going ? "See you there!" : "You're no longer going", going ? "success" : "info");
    await this.reload();
  }

  private async deleteEvent(): Promise<void> {
    const { event } = this.detail;
    const sure = await confirmAction("Delete this event?", `“${event.title}”, its packing list and its photos will be deleted for everyone.`, "Delete event", true);
    if (!sure) return;

    try {
      await events.remove(this.id);
      toast("Event deleted");
      go(`/tribes/${event.tribe_id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  /* ── The hero ───────────────────────────────────── */

  private coverActions(): HTMLElement | null {
    if (!this.detail.can_manage) return null;

    const hasCover = Boolean(this.detail.event.cover_image);
    const change = actionButton([icon("image", "sm"), hasCover ? "Change cover" : "Add cover"], () => this.uploadCover(), { class: "btn btn-sm btn-overlay" });
    const draw = this.detail.model_ready ? actionButton([icon("sparkles", "sm"), "Draw one with AI"], () => this.drawCover(), { class: "btn btn-sm btn-overlay" }) : null;
    const remove = hasCover ? actionButton(icon("trash", "sm"), () => this.removeCover(), { class: "btn btn-sm btn-overlay btn-icon", "aria-label": "Remove cover", title: "Remove cover" }) : null;

    return h("div", { class: "cover-actions" }, change, draw, remove);
  }

  private rsvpButton(): HTMLElement {
    const over = this.detail.event.starts_at < Date.now() / 1000 - OVER_AFTER;
    if (over) return h("span", { class: "badge" }, "This event has ended");

    if (this.detail.event.my_rsvp !== "going") {
      return actionButton([icon("check"), "I'm going"], () => this.setGoing(true), { class: "btn btn-primary" });
    }

    const trigger = h("button", { type: "button", class: "btn btn-soft" }, icon("check"), "You're going", icon("chevronDown", "sm"));
    const cancel = () => void this.setGoing(false).catch((error: unknown) => toast(errorMessage(error), "error"));
    return dropdown(trigger, () => [menuItem("x", "I can't make it", cancel)]);
  }

  private moreMenu(): HTMLElement {
    const entries = (): MenuEntry[] => {
      const everyone = [
        menuItem("download", "Add to calendar", () => downloadCalendarFile(this.detail.event)),
        menuItem("navigation", "Directions", null, { href: tripDirections(this.detail), target: "_blank", rel: "noopener" }),
      ];
      if (!this.detail.can_manage) return everyone;

      const edit = menuItem("edit", "Edit event", null, { href: `#/events/${this.id}/edit` });
      const remove = menuItem("trash", "Delete event", () => void this.deleteEvent(), { class: "menu-danger" });
      return [...everyone, "-", edit, remove];
    };
    return dropdown(h("button", { type: "button", class: "btn btn-icon", "aria-label": "More actions" }, icon("more")), entries);
  }

  private facts(): HTMLElement {
    const { event, stops } = this.detail;
    const more = stops.length ? h("span", { class: "muted" }, ` + ${count(stops.length, "more place")}`) : null;

    return h("div", { class: "facts" },
      h("span", {}, icon("calendar"), `${formatLongDay(event.starts_at)} · ${formatTime(event.starts_at)}`),
      h("span", {}, icon("pin"), event.meeting_point.name, more),
      h("span", {}, icon("users"), `${event.going_count} going`));
  }

  private drawHero(): void {
    const { event } = this.detail;
    const title = h("div", { class: "grow hero-title" },
      h("a", { class: "crumb", href: `#/tribes/${event.tribe_id}` }, icon("users", "sm"), event.tribe_name),
      h("h1", {}, event.title),
      this.facts());
    const actions = h("div", { class: "hero-actions" },
      this.rsvpButton(),
      h("button", { type: "button", class: "btn", onclick: () => void share(event) }, icon("share"), "Share"),
      this.moreMenu());

    mount(this.heroSlot,
      h("div", { class: "hero-cover-wrap" }, eventCover(event, { size: "large", className: "hero-cover" }), this.coverActions()),
      h("div", { class: "hero-head" }, title, actions));
  }

  /* ── The tabs ───────────────────────────────────── */

  private tabView(): TabView {
    switch (this.tab) {
      case "overview":
        return overviewTab(this);
      case "list":
        return packingTab(this);
      case "route":
        return gettingThereTab(this);
      case "photos":
        return photosTab(this);
    }
  }

  private drawTabs(): void {
    const { items, photos } = this.detail;
    const choices = [
      { value: "overview" as const, label: "Overview" },
      { value: "list" as const, label: "Packing list", count: items.length },
      { value: "route" as const, label: "Getting there" },
      { value: "photos" as const, label: "Photos", count: photos.length },
    ];
    mount(this.tabsSlot, tabBar<Tab>(choices, this.tab, (tab) => this.selectTab(tab)));

    const view = this.tabView();
    mount(this.bodySlot, view.element);
    view.start?.();
  }
}

/** Draws the event page, opening the tab named in the address. */
export async function renderEvent(view: HTMLElement, eventId: string, tab: string | null): Promise<void> {
  new EventPage(view, await events.detail(eventId), parseTab(tab));
}
