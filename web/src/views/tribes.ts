// Tribes: the ones you're in, and every other one you could join. Typing in
// the box searches the server's index, so any word matches in any form and
// near spellings count: "ai replacing" finds "ai-won't-replace-us".

import { discovery, tribes as tribesApi } from "../api/client.js";
import type { Tribe } from "../api/types.js";
import { tribeCard } from "../components/cards.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { debounce, segmented } from "../ui/controls.js";
import { emptyState } from "../ui/feedback.js";

/** Which tribes the list shows. */
type Show = "all" | "joined";

function nothingShown(searching: boolean, show: Show): HTMLElement {
  const startButton = h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe");
  if (searching) return emptyState("users", "No tribes match", "Try other words, or start the tribe you're looking for.", startButton);

  const title = show === "joined" ? "You haven't joined a tribe yet" : "No tribes yet";
  return emptyState("users", title, "Start one for your friends, club or neighbourhood.", startButton);
}

/** The tribes page. */
class TribesPage {
  private readonly grid = h("div");

  /** Every tribe, for when nothing is typed. */
  private all: Tribe[];
  /** The search's matches, best first, or null when nothing is typed. */
  private matches: Tribe[] | null = null;
  private show: Show = "all";
  /** Counts searches, so a slow answer to an old one is ignored. */
  private searchNumber = 0;

  constructor(view: HTMLElement, tribes: Tribe[]) {
    this.all = tribes;

    const search = h("input", { type: "search", placeholder: "Search tribes: any word, any spelling", "aria-label": "Search tribes" });
    search.addEventListener("input", debounce(() => void this.search(search.value.trim()), 200));

    const which = segmented<Show>([{ value: "all", label: "All tribes" }, { value: "joined", label: "Joined" }], this.show, (value) => {
      this.show = value;
      this.draw();
    }, "Which tribes");

    const head = h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Tribes"), h("p", {}, "Groups that get outside together. Join one, or start your own.")),
      h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "New tribe"));

    mount(view, head, h("div", { class: "toolbar" }, h("div", { class: "input-wrap" }, icon("search"), search), which), this.grid);
    this.draw();
  }

  private async search(text: string): Promise<void> {
    this.searchNumber += 1;
    const number = this.searchNumber;

    if (text.length < 2) {
      this.matches = null;
      this.draw();
      return;
    }

    const found = await discovery.search(text).catch(() => null);
    if (number !== this.searchNumber) return;

    this.matches = found?.tribes ?? [];
    this.draw();
  }

  /** Puts a tribe changed by its card, such as after joining, back in both lists. */
  private replace(updated: Tribe): void {
    const swap = (tribe: Tribe) => (tribe.id === updated.id ? updated : tribe);

    this.all = this.all.map(swap);
    this.matches = this.matches?.map(swap) ?? null;
    this.draw();
  }

  private draw(): void {
    const source = this.matches ?? this.all;
    const shown = source.filter((tribe) => this.show === "all" || tribe.is_member);

    if (!shown.length) {
      mount(this.grid, h("div", { class: "card" }, nothingShown(this.matches !== null, this.show)));
      return;
    }

    mount(this.grid, h("div", { class: "grid-cards" }, shown.map((tribe) => tribeCard(tribe, (updated) => this.replace(updated)))));
  }
}

/** Draws the tribes page. */
export async function renderTribes(view: HTMLElement): Promise<void> {
  new TribesPage(view, await tribesApi.list());
}
