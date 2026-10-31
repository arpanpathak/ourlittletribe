// Tribes: the ones you're in, and every other one you could join.

import { api } from "../api.js";
import { h, mount, icon, emptyState, segmented, debounce } from "../ui.js";
import { tribeCard } from "../components/cards.js";

/** Draws the tribes page. */
export async function renderTribes(view) {
  let tribes = await api.tribes();
  let show = "all";
  let text = "";
  const grid = h("div");

  function draw() {
    const needle = text.trim().toLowerCase();
    const shown = tribes.filter((tribe) => {
      if (show === "joined" && !tribe.is_member) return false;
      if (!needle) return true;
      return [tribe.name, tribe.home_area, tribe.description].some((value) => value.toLowerCase().includes(needle));
    });
    const replaced = (updated) => {
      tribes = tribes.map((tribe) => (tribe.id === updated.id ? updated : tribe));
      draw();
    };
    mount(grid, shown.length
      ? h("div", { class: "grid-cards" }, shown.map((tribe) => tribeCard(tribe, replaced)))
      : h("div", { class: "card" }, emptyState("users",
          needle ? "No tribes match" : show === "joined" ? "You haven't joined a tribe yet" : "No tribes yet",
          needle ? "Try other words, or start the tribe you're looking for." : "Start one for your friends, club or neighbourhood.",
          h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "Start a tribe"))));
  }

  const search = h("input", { type: "search", placeholder: "Search tribes", "aria-label": "Search tribes" });
  search.addEventListener("input", debounce(() => {
    text = search.value;
    draw();
  }, 120));

  mount(view,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Tribes"), h("p", {}, "Groups that get outside together. Join one, or start your own.")),
      h("a", { class: "btn btn-primary", href: "#/tribes/new" }, icon("plus"), "New tribe")),
    h("div", { class: "toolbar" },
      h("div", { class: "input-wrap" }, icon("search"), search),
      segmented([["all", "All tribes"], ["joined", "Joined"]], show, (value) => {
        show = value;
        draw();
      }, "Which tribes")),
    grid);
  draw();
}
