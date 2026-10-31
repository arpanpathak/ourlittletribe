// One tribe: who's in it and what it has planned.

import { api } from "../api.js";
import { emblem, skyline, squatch } from "../art.js";
import { h, mount, toast, avatar, busyButton } from "../ui.js";
import { eventCard } from "./tribes.js";

const SKY_FOR_EMBLEM = { peak: "dawn", forest: "dawn", wave: "dusk", coffee: "dusk", book: "night", bike: "dawn" };

/** Draws the tribe page. */
export async function renderTribe(view, tribeId) {
  const detail = await api.tribe(tribeId);
  const { tribe, members, events } = detail;
  const sky = SKY_FOR_EMBLEM[tribe.emblem] || "dawn";

  const membership = tribe.is_member
    ? busyButton("Leave tribe", async () => {
        await api.leaveTribe(tribe.id);
        toast(`You left ${tribe.name}`);
        renderTribe(view, tribeId);
      }, { class: "button ghost" })
    : busyButton("Join tribe", async () => {
        await api.joinTribe(tribe.id);
        toast(`Welcome to ${tribe.name}!`, "success");
        renderTribe(view, tribeId);
      }, { class: "button primary" });

  mount(
    view,
    h("section", { class: `page-hero sky-${sky}` },
      h("div", { class: "page-hero-art", html: skyline(sky, { stars: sky === "night" }) }),
      h("div", { class: "page-hero-inner" },
        h("div", { class: "hero-title-row" },
          h("div", { class: "hero-emblem", html: emblem(tribe.emblem, 64) }),
          h("div", {},
            h("h1", {}, tribe.name),
            h("p", { class: "lead" }, [tribe.home_area, `${tribe.member_count} ${tribe.member_count === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")),
          ),
        ),
        h("div", { class: "hero-actions" },
          tribe.is_member ? h("a", { class: "button primary", href: `#/events/new?tribe=${tribe.id}` }, "Plan an outing") : null,
          membership),
      ),
    ),
    h("div", { class: "home-grid" },
      h("section", { class: "stack" },
        tribe.description ? h("div", { class: "card prose" }, h("p", {}, tribe.description)) : null,
        h("h2", { class: "section-title" }, "Coming up"),
        events.length
          ? h("div", { class: "list" }, events.map(eventCard))
          : h("div", { class: "empty card" }, h("div", { html: squatch("think", 100) }), h("p", {}, "Nothing planned yet."),
              tribe.is_member ? h("a", { class: "button primary", href: `#/events/new?tribe=${tribe.id}` }, "Plan the first one") : null),
      ),
      h("aside", { class: "card" },
        h("h3", {}, "Members"),
        h("ul", { class: "plain-list" }, members.map((member) =>
          h("li", {}, h("a", { class: "row-link", href: `#/people/${member.user_id}` },
            avatar(member.name, 30), h("span", {}, member.name),
            member.role === "organizer" ? h("span", { class: "pill pill-moss push" }, "Organizer") : null)))),
      ),
    ),
  );
}
