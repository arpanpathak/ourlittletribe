// The shared packing list: what to bring, who has what, model suggestions,
// and "ask for ideas" in your own words.

import { items as itemsApi } from "../../api/client.js";
import type { EventDetail, ItemMark, MarkState, PlannedItem, PrepItem, Scope, User } from "../../api/types.js";
import { h, mount } from "../../dom.js";
import { count } from "../../format.js";
import { icon } from "../../icons.js";
import { actionButton } from "../../ui/controls.js";
import { emptyState, errorMessage, toast } from "../../ui/feedback.js";
import { dropdown, menuItem } from "../../ui/menu.js";
import { avatarStack } from "../../ui/pictures.js";
import type { EventScreen, TabView } from "./screen.js";

function myMark(item: PrepItem, me: User): ItemMark | null {
  return item.marks.find((mark) => mark.user_id === me.id) ?? null;
}

/** Whether the viewer has nothing left to do for an item. */
export function isSortedFor(item: PrepItem, me: User): boolean {
  switch (item.scope) {
    case "shared":
      return item.marks.length > 0;
    case "personal":
      return myMark(item, me)?.state === "got";
  }
}

/** How many items the viewer has nothing left to do for. */
export function sortedCount(detail: EventDetail, me: User): number {
  return detail.items.filter((item) => isSortedFor(item, me)).length;
}

/** A bar showing how much of the list is sorted. */
export function progressBar(sorted: number, total: number): HTMLElement | null {
  if (!total) return null;
  return h("div", { class: "progress" }, h("span", { style: `width:${Math.round((sorted / total) * 100)}%` }));
}

function nameOrYou(mark: ItemMark, me: User): string {
  return mark.user_id === me.id ? "you" : mark.name;
}

/** One row of the list, with its buttons. */
class ItemRow {
  private readonly mine: ItemMark | null;
  private readonly got: ItemMark[];
  private readonly bringing: ItemMark[];

  constructor(private readonly screen: EventScreen, private readonly item: PrepItem) {
    this.mine = myMark(item, screen.me);
    this.got = item.marks.filter((mark) => mark.state === "got");
    this.bringing = item.marks.filter((mark) => mark.state === "bringing");
  }

  private get checked(): boolean {
    return this.item.scope === "shared" ? this.got.length > 0 : this.mine?.state === "got";
  }

  /** Whether someone else has a shared item covered. */
  private get takenByOther(): boolean {
    return this.item.scope === "shared" && this.item.marks.length > 0 && !this.mine;
  }

  private async mark(state: MarkState | null): Promise<void> {
    const updated = state ? await itemsApi.setMark(this.item.id, state) : await itemsApi.clearMark(this.item.id);
    this.screen.update((detail) => {
      detail.items = updated;
    });
  }

  private async remove(): Promise<void> {
    try {
      const updated = await itemsApi.remove(this.item.id);
      this.screen.update((detail) => {
        detail.items = updated;
      });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  private checkTitle(): string {
    if (this.takenByOther) return "Someone else has this covered";
    if (this.checked) return "Undo";
    return this.item.scope === "shared" ? "I got this for the group" : "I have this";
  }

  private checkButton(): HTMLElement {
    const { name } = this.item;
    const disabled = !this.screen.detail.is_member || this.takenByOther;
    const onclick = () => void this.mark(this.checked ? null : "got").catch((error: unknown) => toast(errorMessage(error), "error"));

    return h("button", {
      type: "button",
      class: this.checked ? "check on" : "check",
      "aria-pressed": String(this.checked),
      "aria-label": this.checked ? `Mark ${name} as not got` : `Mark ${name} as got`,
      title: this.checkTitle(),
      disabled: disabled ? true : null,
      onclick,
    }, icon("check"));
  }

  private status(): HTMLElement {
    const me = this.screen.me;
    if (this.item.scope === "personal") {
      const goingCount = Math.max(this.screen.detail.event.going_count, 1);
      return h("span", {}, `${this.got.length} of ${goingCount} going have it`);
    }

    const [buyer] = this.got;
    const [bringer] = this.bringing;
    if (buyer) return h("span", { class: "badge badge-accent" }, `Bought by ${nameOrYou(buyer, me)}`);
    if (bringer) return h("span", { class: "badge badge-warning" }, bringer.user_id === me.id ? "You're bringing it" : `${bringer.name} is bringing it`);
    return h("span", { class: "badge" }, "Nobody yet");
  }

  private sideButtons(): HTMLElement[] {
    const { detail, me } = this.screen;
    const shared = this.item.scope === "shared";
    const buttons: HTMLElement[] = [];

    if (detail.is_member && shared && !this.item.marks.length) {
      buttons.push(actionButton("I'll bring it", () => this.mark("bringing"), { class: "btn btn-sm" }));
    }
    if (detail.is_member && shared && this.mine?.state === "bringing") {
      buttons.push(actionButton("Drop", () => this.mark(null), { class: "btn btn-sm btn-ghost" }));
    }

    const mayRemove = me.is_admin || this.item.user_id === me.id || detail.can_manage;
    if (mayRemove) {
      const trigger = h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": `More for ${this.item.name}` }, icon("more"));
      buttons.push(dropdown(trigger, () => [menuItem("trash", "Remove from list", () => void this.remove(), { class: "menu-danger" })]));
    }
    return buttons;
  }

  private details(): HTMLElement {
    const { item } = this;
    const name = h("div", { class: "item-name" },
      h("span", {}, item.name),
      item.quantity > 1 ? h("span", { class: "badge" }, `×${item.quantity}`) : null,
      item.source === "model" ? h("span", { class: "badge badge-ai", title: "Suggested by the planning model" }, icon("sparkles", "sm"), "Suggested") : null);

    const shops = item.shop_tags.length ? h("span", {}, `Sold at ${item.shop_tags.map((tag) => tag.replace(/_/g, " ")).join(", ")} shops`) : null;
    const meta = h("div", { class: "item-meta" }, this.status(), item.marks.length ? avatarStack(item.marks, 22, 6) : null, shops);

    const pairings = item.often_with ?? [];
    const often = pairings.length ? h("p", { class: "often" }, "Groups who bought this also got ", h("b", {}, pairings.map((pairing) => pairing.item).join(", "))) : null;

    return h("div", { class: "item-text" }, name, item.why ? h("p", { class: "item-why" }, item.why) : null, meta, often);
  }

  element(): HTMLElement {
    return h("li", { class: this.checked ? "item done" : "item" }, this.checkButton(), this.details(), h("div", { class: "item-side" }, this.sideButtons()));
  }
}

/* ── Ask for ideas ────────────────────────────────── */

function suggestionRow(screen: EventScreen, item: PlannedItem, listed: Set<string>): HTMLElement {
  const text = h("div", { class: "item-text" }, h("div", { class: "strong" }, item.name), h("p", { class: "item-why" }, item.why));
  if (listed.has(item.name.toLowerCase())) return h("div", { class: "suggest" }, text, h("span", { class: "badge badge-accent" }, "On the list"));
  if (!screen.detail.is_member) return h("div", { class: "suggest" }, text);

  const add = actionButton([icon("plus", "sm"), "Add"], async () => {
    await itemsApi.add(screen.detail.event.id, item);
    toast(`Added ${item.name}`, "success");
    await screen.reload();
  }, { class: "btn btn-sm" });
  return h("div", { class: "suggest" }, text, add);
}

function askBox(screen: EventScreen): HTMLElement {
  const input = h("input", { type: "search", placeholder: "e.g. my feet get cold", maxlength: 200 });
  const results = h("div");
  const form = h("form", { class: "stack" }, h("div", { class: "ask" }, h("div", { class: "input-wrap" }, icon("sparkles"), input), h("button", { type: "submit", class: "btn btn-primary" }, "Ask")), results);

  form.addEventListener("submit", async (submitted) => {
    submitted.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    mount(results, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Thinking about your trip…"));
    try {
      const found = await itemsApi.suggestions(screen.detail.event.id, question);
      if (!found.items.length) {
        mount(results, h("p", { class: "small muted" }, "Nothing came up. Try describing it differently."));
        return;
      }

      const listed = new Set(screen.detail.items.map((item) => item.name.toLowerCase()));
      const storeCount = found.trip.stores.length;
      const stores = storeCount ? h("button", { type: "button", class: "btn btn-sm self-start", onclick: () => screen.openTab("route") }, icon("store", "sm"), `See ${count(storeCount, "store")} on your way`) : null;
      mount(results, h("div", { class: "suggest-list" }, found.items.map((item) => suggestionRow(screen, item, listed)), stores));
    } catch (error) {
      mount(results, h("p", { class: "small text-danger" }, errorMessage(error)));
    }
  });
  return form;
}

/* ── The tab ──────────────────────────────────────── */

function suggestButton(screen: EventScreen): HTMLElement | null {
  const { detail } = screen;
  if (!detail.model_ready || !detail.is_member) return null;

  const hasItems = detail.items.length > 0;
  return actionButton([icon("sparkles"), hasItems ? "Suggest more" : "Suggest items"], async (button) => {
    button.replaceChildren(h("span", { class: "spinner" }), "Reading the plan, forecast and route…");
    const result = await itemsApi.plan(detail.event.id);
    toast(result.added ? `Added ${result.added} suggestions` : "No new suggestions", result.added ? "success" : "info");
    screen.update((current) => {
      current.items = result.items;
    });
  }, { class: hasItems ? "btn" : "btn btn-primary" });
}

function addForm(screen: EventScreen): HTMLElement {
  const name = h("input", { placeholder: "Add an item, e.g. bear spray", maxlength: 80, "aria-label": "Item name" });
  const scope = h("select", { "aria-label": "Who brings it" }, h("option", { value: "personal" }, "Everyone brings one"), h("option", { value: "shared" }, "One for the group"));
  const form = h("form", { class: "add-row" }, name, scope, h("button", { type: "submit", class: "btn" }, icon("plus", "sm"), "Add"));

  form.addEventListener("submit", async (submitted) => {
    submitted.preventDefault();
    const text = name.value.trim();
    if (!text) {
      name.focus();
      return;
    }

    try {
      await itemsApi.add(screen.detail.event.id, { name: text, scope: scope.value as Scope });
      await screen.reload();
      document.querySelector<HTMLInputElement>(".add-row input")?.focus();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  });
  return form;
}

function group(screen: EventScreen, title: string, text: string, list: PrepItem[]): HTMLElement | null {
  if (!list.length) return null;
  return h("section", {},
    h("div", { class: "row-between group-head" }, h("h4", {}, title), h("span", { class: "small muted" }, text)),
    h("ul", { class: "items" }, list.map((item) => new ItemRow(screen, item).element())));
}

function listCard(screen: EventScreen): HTMLElement {
  const { detail, me } = screen;
  const all = detail.items;
  const sorted = sortedCount(detail, me);

  const emptyText = detail.model_ready ? "Get suggestions from the plan, the forecast at the meeting point and the drive, or add your own." : "Add what the group should bring.";
  const groups = all.length
    ? [group(screen, "For the group", "One person brings it", all.filter((item) => item.scope === "shared")), group(screen, "Everyone brings their own", "Tick it when you have it", all.filter((item) => item.scope === "personal"))]
    : emptyState("list", "The list is empty", emptyText);
  const adding = detail.is_member ? addForm(screen) : h("p", { class: "small muted" }, "Say you're going to add items and tick them off.");

  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("div", {}, h("h3", {}, "Packing list"), h("p", { class: "small muted card-sub" }, all.length ? `${sorted} of ${all.length} sorted for you` : "Shared by everyone going")), suggestButton(screen)),
    h("div", { class: "card-body stack-lg" }, progressBar(sorted, all.length), groups, adding));
}

function sideColumn(screen: EventScreen): HTMLElement {
  const { detail } = screen;
  const ideas = detail.model_ready && detail.is_member
    ? h("section", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "Ask for ideas")),
        h("div", { class: "card-body stack" },
          h("p", { class: "small text-2" }, "Describe a need in your own words, like “my feet get cold” or “snacks kids like”. The model suggests items for this trip, and the map finds stores on your way."),
          askBox(screen)))
    : null;

  const howItWorks = h("section", { class: "card" }, h("div", { class: "card-body stack" },
    h("h4", {}, "How it works"),
    h("p", { class: "small text-2" }, "Tick what you have. Items for the group need just one person: press “I'll bring it” to claim one, and tick it once it's bought. Everyone going sees who has what.")));

  return h("aside", { class: "sticky-col" }, ideas, howItWorks);
}

/** The packing list tab. */
export function packingTab(screen: EventScreen): TabView {
  return { element: h("div", { class: "split tab-body" }, h("div", { class: "stack-lg" }, listCard(screen)), sideColumn(screen)) };
}
