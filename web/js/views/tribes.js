// The tribes list, starting a tribe, and the cards other pages reuse.

import { api } from "../api.js";
import { EMBLEM_NAMES, emblem, skyline, squatch } from "../art.js";
import { h, mount, toast, formatWhen, relativeTime } from "../ui.js";
import { go } from "../app.js";

/** A card for one tribe. */
export function tribeCard(tribe) {
  return h("a", { class: "tribe-card card", href: `#/tribes/${tribe.id}` },
    h("div", { class: "tribe-card-emblem", html: emblem(tribe.emblem, 52) }),
    h("div", { class: "tribe-card-body" },
      h("h3", {}, tribe.name),
      tribe.home_area ? h("p", { class: "muted small" }, tribe.home_area) : null,
      tribe.description ? h("p", { class: "clamp-2" }, tribe.description) : null,
      h("p", { class: "small meta" },
        `${tribe.member_count} ${tribe.member_count === 1 ? "member" : "members"}`,
        tribe.is_member ? h("span", { class: "pill pill-moss" }, tribe.is_organizer ? "Organizer" : "Member") : null),
    ),
  );
}

/** A card for one event. */
export function eventCard(event) {
  const date = new Date(event.starts_at * 1000);
  return h("a", { class: "event-card card", href: `#/events/${event.id}` },
    h("div", { class: "event-date" },
      h("span", { class: "event-month" }, date.toLocaleDateString(undefined, { month: "short" })),
      h("span", { class: "event-day" }, String(date.getDate())),
    ),
    h("div", { class: "event-card-body" },
      h("p", { class: "eyebrow tribe-tag" }, h("span", { html: emblem(event.tribe_emblem, 18) }), event.tribe_name),
      h("h3", {}, event.title),
      h("p", { class: "muted small" }, `${formatWhen(event.starts_at)} · ${event.place_name}`),
      h("p", { class: "small meta" },
        h("span", { class: "pill" }, `${event.going_count} going`),
        event.my_rsvp === "going" ? h("span", { class: "pill pill-moss" }, "You're in") : null,
        h("span", { class: "muted" }, relativeTime(event.starts_at)),
      ),
    ),
  );
}

function newTribeForm(onCreated) {
  let chosen = "peak";
  const picker = h("div", { class: "emblem-picker", role: "radiogroup", "aria-label": "Emblem" });
  function drawPicker() {
    mount(picker, EMBLEM_NAMES.map((name) =>
      h("button", {
        type: "button",
        class: `emblem-choice${name === chosen ? " chosen" : ""}`,
        role: "radio",
        "aria-checked": name === chosen ? "true" : "false",
        "aria-label": name,
        onclick: () => {
          chosen = name;
          drawPicker();
        },
        html: emblem(name, 40),
      })));
  }
  drawPicker();
  const form = h("form", { class: "card stack" },
    h("h3", {}, "Start a tribe"),
    h("label", {}, "Name", h("input", { name: "name", required: true, maxlength: 80, placeholder: "Cascade Morning Walkers" })),
    h("label", {}, "Where you meet", h("input", { name: "home_area", maxlength: 80, placeholder: "Ballard, Seattle" })),
    h("label", {}, "What it's about", h("textarea", { name: "description", rows: 3, maxlength: 2000, placeholder: "Easy weekend hikes, dogs welcome, coffee after." })),
    h("div", {}, h("span", { class: "label" }, "Emblem"), picker),
    h("button", { type: "submit", class: "button primary" }, "Start tribe"),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const tribe = await api.createTribe({
        name: data.get("name"),
        home_area: data.get("home_area"),
        description: data.get("description"),
        emblem: chosen,
      });
      toast(`${tribe.name} is live`, "success");
      onCreated(tribe);
    } catch (error) {
      toast(error.message, "error");
    }
  });
  return form;
}

/** Draws the list of tribes. */
export async function renderTribes(view) {
  const tribes = await api.tribes();
  const formSlot = h("div");
  const mine = tribes.filter((tribe) => tribe.is_member);
  const others = tribes.filter((tribe) => !tribe.is_member);
  mount(
    view,
    h("section", { class: "page-hero compact" },
      h("div", { class: "page-hero-art", html: skyline("dusk") }),
      h("div", { class: "page-hero-inner" },
        h("div", {},
          h("h1", {}, "Tribes"),
          h("p", { class: "lead" }, "Small groups that get outside together. Join one or start your own."),
        ),
        h("button", {
          class: "button primary",
          onclick: () => {
            mount(formSlot, newTribeForm((tribe) => go(`/tribes/${tribe.id}`)));
            formSlot.scrollIntoView({ behavior: "smooth" });
          },
        }, "Start a tribe"),
      ),
    ),
    formSlot,
    mine.length ? h("section", {}, h("h2", { class: "section-title" }, "Your tribes"), h("div", { class: "grid" }, mine.map(tribeCard))) : null,
    h("section", {},
      h("h2", { class: "section-title" }, mine.length ? "More tribes" : "All tribes"),
      others.length
        ? h("div", { class: "grid" }, others.map(tribeCard))
        : h("div", { class: "empty" }, h("div", { html: squatch("map", 110) }), h("p", {}, mine.length ? "You're in every tribe here." : "No tribes yet. Start the first one."))),
  );
}
