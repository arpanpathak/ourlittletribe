// One tribe: its cover, what it's planning, what it did, and who's in it.

import { api } from "../api.js";
import { h, mount, icon, toast, avatar, actionButton, tabBar, emptyState, dropdown, menuItem, confirmAction, copyText, tribeCover, relativeTime } from "../ui.js";
import { replaceRoute, session } from "../app.js";
import { eventCard } from "../components/cards.js";
import { choosePictures, pictureProblem } from "../components/picture_picker.js";

const TABS = ["events", "past", "members", "about"];

/** Draws the tribe page, opening `initialTab`. */
export async function renderTribe(view, tribeId, initialTab) {
  let detail = await api.tribe(tribeId);
  let tab = TABS.includes(initialTab) ? initialTab : "events";
  const me = session.user;
  const canManage = () => detail.tribe.is_organizer || me.is_admin;
  const body = h("div", { style: "margin-top:24px" });
  const tabsSlot = h("div");
  const heroSlot = h("div", { class: "stack-lg" });

  async function refresh() {
    detail = await api.tribe(tribeId);
    draw();
  }

  function drawHero() {
    const { tribe } = detail;
    const coverButtons = canManage()
      ? h("div", { class: "cover-actions" },
          actionButton([icon("image", "sm"), tribe.cover_image ? "Change cover" : "Add cover"], async () => {
            const [file] = await choosePictures(false);
            if (!file) return;
            const problem = pictureProblem(file);
            if (problem) throw new Error(problem);
            await api.setTribeCover(tribeId, file);
            toast("Cover updated", "success");
            await refresh();
          }, { class: "btn btn-sm btn-overlay" }))
      : null;

    const membership = tribe.is_member
      ? dropdown(h("button", { type: "button", class: "btn btn-soft" }, icon("check"), tribe.is_organizer ? "Organizer" : "Member", icon("chevronDown", "sm")), () => [
          menuItem("logout", "Leave tribe", async () => {
            if (!(await confirmAction("Leave this tribe?", `You'll stop seeing ${tribe.name}'s plans in your feed. You can join again any time.`, "Leave tribe", true))) return;
            try {
              await api.leaveTribe(tribeId);
              toast(`You left ${tribe.name}`);
              await refresh();
            } catch (error) {
              toast(error.message, "error");
            }
          }, { class: "menu-danger" }),
        ])
      : actionButton([icon("plus"), "Join tribe"], async () => {
          await api.joinTribe(tribeId);
          toast(`Welcome to ${tribe.name}!`, "success");
          await refresh();
        }, { class: "btn btn-primary" });

    mount(heroSlot,
      h("div", { style: "position:relative" }, tribeCover(tribe, { small: false, className: "hero-cover" }), coverButtons),
      h("div", { class: "hero-head" },
        h("div", { class: "tribe-identity" },
          h("div", { class: "thumb" }, tribeCover({ ...tribe, cover_image: null })),
          h("div", {},
            h("h1", { style: "margin:0 0 6px" }, tribe.name),
            h("div", { class: "facts" },
              tribe.home_area ? h("span", {}, icon("pin"), tribe.home_area) : null,
              h("span", {}, icon("users"), `${tribe.member_count} ${tribe.member_count === 1 ? "member" : "members"}`)))),
        h("div", { class: "hero-actions" },
          tribe.is_member ? h("a", { class: "btn btn-primary", href: `#/events/new?tribe=${tribe.id}` }, icon("plus"), "Plan an event") : null,
          membership,
          dropdown(h("button", { type: "button", class: "btn btn-icon", "aria-label": "More actions" }, icon("more")), () => [
            menuItem("link", "Copy link", () => copyText(window.location.href.split("?")[0])),
            canManage() ? menuItem("edit", "Edit tribe", null, { href: `#/tribes/${tribeId}/edit` }) : null,
          ].filter(Boolean)))));
  }

  function drawBody() {
    const { tribe, members, events, past_events: past } = detail;
    if (tab === "events") {
      mount(body, events.length
        ? h("div", { class: "grid-cards" }, events.map(eventCard))
        : h("div", { class: "card" }, emptyState("calendar", "Nothing planned yet",
            tribe.is_member ? "Plan the next outing and everyone in the tribe will see it." : "Join the tribe to plan outings with it.",
            tribe.is_member ? h("a", { class: "btn btn-primary", href: `#/events/new?tribe=${tribe.id}` }, icon("plus"), "Plan an event") : null)));
    } else if (tab === "past") {
      mount(body, past.length
        ? h("div", { class: "grid-cards" }, past.map(eventCard))
        : h("div", { class: "card" }, emptyState("clock", "No past events", "Outings show up here after they happen, with their photos.")));
    } else if (tab === "members") {
      mount(body, h("div", { class: "card" },
        h("div", { class: "card-body" },
          h("div", { class: "people-grid", style: "grid-template-columns:repeat(auto-fill,minmax(240px,1fr))" }, members.map((member) =>
            h("a", { class: "person", href: `#/people/${member.user_id}` },
              avatar(member.name, 40),
              h("div", { style: "min-width:0" },
                h("div", { class: "strong ellipsis" }, member.name),
                h("div", { class: "tiny muted" }, member.role === "organizer" ? "Organizer" : `Joined ${relativeTime(member.joined_at)}`))))))));
    } else {
      mount(body, h("div", { class: "card" },
        h("div", { class: "card-head" }, h("h3", {}, "About"),
          canManage() ? h("a", { class: "btn btn-ghost btn-sm", href: `#/tribes/${tribeId}/edit` }, icon("edit", "sm"), "Edit") : null),
        h("div", { class: "card-body" }, tribe.description
          ? h("p", { class: "description" }, tribe.description)
          : h("p", { class: "muted" }, "No description yet."))));
    }
  }

  function draw() {
    drawHero();
    mount(tabsSlot, tabBar([
      ["events", "Upcoming", detail.events.length],
      ["past", "Past", detail.past_events.length],
      ["members", "Members", detail.members.length],
      ["about", "About"],
    ], tab, (value) => {
      tab = value;
      replaceRoute(`/tribes/${tribeId}${value === "events" ? "" : `?tab=${value}`}`);
      drawBody();
    }));
    drawBody();
  }

  mount(view, heroSlot, h("div", {}, tabsSlot, body));
  draw();
}
