// Tribes: the ones you're in, and every other one you could join.

import { tribes as tribesApi } from "../api/client.js";
import type { Tribe } from "../api/types.js";
import { tribeCard } from "../components/cards.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { debounce, segmented } from "../ui/controls.js";
import { emptyState } from "../ui/feedback.js";

/** Which tribes the list shows. */
type Show = "all" | "joined";

function matches(tribe: Tribe, needle: string): boolean {
  if (!needle) return true;
  return [tribe.name, tribe.home_area, tribe.description].some((value) => value.toLowerCase().includes(needle));
}

function nothingShown(needle: string, show: Show): HTMLElement {
  const startButton = h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe");
  if (needle) return emptyState("users", "No tribes match", "Try other words, or start the tribe you're looking for.", startButton);

  const title = show === "joined" ? "You haven't joined a tribe yet" : "No tribes yet";
  return emptyState("users", title, "Start one for your friends, club or neighbourhood.", startButton);
}

/** Draws the tribes page. */
export async function renderTribes(view: HTMLElement): Promise<void> {
  let tribes = await tribesApi.list();
  let show: Show = "all";
  let needle = "";
  const grid = h("div");

  const replace = (updated: Tribe) => {
    tribes = tribes.map((tribe) => (tribe.id === updated.id ? updated : tribe));
    draw();
  };

  function draw(): void {
    const shown = tribes.filter((tribe) => (show === "all" || tribe.is_member) && matches(tribe, needle));
    if (!shown.length) {
      mount(grid, h("div", { class: "card" }, nothingShown(needle, show)));
      return;
    }
    mount(grid, h("div", { class: "grid-cards" }, shown.map((tribe) => tribeCard(tribe, replace))));
  }

  const search = h("input", { type: "search", placeholder: "Search tribes", "aria-label": "Search tribes" });
  search.addEventListener("input", debounce(() => {
    needle = search.value.trim().toLowerCase();
    draw();
  }, 120));

  const which = segmented<Show>([{ value: "all", label: "All tribes" }, { value: "joined", label: "Joined" }], show, (value) => {
    show = value;
    draw();
  }, "Which tribes");

  const head = h("div", { class: "page-head" },
    h("div", {}, h("h1", {}, "Tribes"), h("p", {}, "Groups that get outside together. Join one, or start your own.")),
    h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "New tribe"));

  mount(view, head, h("div", { class: "toolbar" }, h("div", { class: "input-wrap" }, icon("search"), search), which), grid);
  draw();
}
