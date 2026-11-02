// The frame around every page: the sidebar on wide screens, the header with
// search and Back, and the tab bar on phones.

import { account, tribes as tribesApi } from "./api/client.js";
import type { Tribe, User } from "./api/types.js";
import { h, mount } from "./dom.js";
import { icon, iconMarkup, type IconName } from "./icons.js";
import { currentUser, go, setUser } from "./session.js";
import { openThemePicker, themeButton as sidebarThemeButton } from "./themes.js";
import { dropdown, menuItem } from "./ui/menu.js";
import { avatar, tribeCover } from "./ui/pictures.js";

/** A top-level page in the navigation. */
interface NavLink {
  /** Its route. */
  path: string;
  /** Its name. */
  label: string;
  /** Its icon. */
  icon: IconName;
}

const NAV: NavLink[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/events", label: "Events", icon: "calendar" },
  { path: "/tribes", label: "Tribes", icon: "users" },
  { path: "/search", label: "Search", icon: "search" },
];

/** Top-level pages; anything deeper gets a Back button. */
const TOP_LEVEL = new Set(NAV.map((link) => link.path));

/** Most tribes listed in the sidebar. */
const SIDEBAR_TRIBES = 8;

/** How long the sidebar's tribe list stays fresh, milliseconds. */
const TRIBES_FRESH_FOR = 15_000;

/** The route and query of the address. */
export interface Location {
  /** The route, such as "/events/abc". */
  path: string;
  /** The query, such as `tab=list`. */
  query: URLSearchParams;
}

/** The current route, read from the address's hash. */
export function currentLocation(): Location {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, queryText] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(queryText ?? "") };
}

function isActive(target: string, path: string): boolean {
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}

/** Where Back goes when there is no earlier page in this visit. */
function parentOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "people") return "/";
  if (parts.length >= 3) return `/${parts[0]}/${parts[1]}`;
  return `/${parts[0] ?? ""}`;
}

/** The sidebar's appearance row: the current theme, which opens the picker. */
function themeSwitch(): HTMLElement {
  return h("div", { class: "theme-switch" }, h("span", { class: "theme-label" }, "Appearance"), sidebarThemeButton());
}

/** The header's theme button on small screens; opens the picker. */
function themeButton(): HTMLElement {
  const dark = document.documentElement.dataset.theme === "dark";
  return h("button", { type: "button", class: "btn btn-ghost btn-icon", title: "Change the theme", "aria-label": "Change the theme", onclick: openThemePicker, html: iconMarkup(dark ? "moon" : "sun") });
}

function logo(): HTMLElement {
  return h("a", { class: "logo", href: "#/" }, h("span", { class: "logo-mark", html: iconMarkup("logoPeak") }), h("span", {}, "OurLittleTribe"));
}

function createMenu(trigger: HTMLElement): HTMLElement {
  return dropdown(trigger, () => [menuItem("calendar", "New event", null, { href: "#/events/new" }), menuItem("users", "New tribe", null, { href: "#/tribes/new" })]);
}

function closeDrawer(): void {
  document.body.classList.remove("drawer-open");
  document.getElementById("scrim")?.remove();
}

function openDrawer(): void {
  document.body.classList.add("drawer-open");
  document.body.appendChild(h("div", { class: "scrim", id: "scrim", onclick: closeDrawer }));
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page has no #${id}`);
  return found;
}

/** The header, sidebar and tab bar, and what they need to remember. */
export class Chrome {
  /** The viewer's tribes, for the sidebar. */
  private myTribes: Tribe[] = [];
  /** When the tribes were last fetched, milliseconds since 1970. */
  private tribesFetchedAt = 0;
  /** Pages visited in this visit, so Back can stay inside the app. */
  private readonly trail: string[] = [];

  constructor(private readonly onSignedOut: () => void) {}

  /** Notes the page just opened, for the Back button. */
  remember(): void {
    const here = window.location.hash || "#/";
    const previous = this.trail[this.trail.length - 2];
    const last = this.trail[this.trail.length - 1];

    if (previous === here) this.trail.pop();
    else if (last !== here) this.trail.push(here);
  }

  closeDrawer(): void {
    closeDrawer();
  }

  /** Draws the header, sidebar and tab bar for the current page. */
  draw(): void {
    const { path, query } = currentLocation();
    const user = currentUser();
    this.drawSidebar(path, user);

    if (!user) {
      mount(element("header"), logo(), h("div", { class: "header-actions header-actions-end" }, themeButton()));
      element("tabbar").hidden = true;
      return;
    }

    this.drawHeader(path, query, user);
    this.drawTabbar(path, user);
  }

  /** Fetches the viewer's tribes again when the list is stale, or when `force` is set. */
  async refreshTribes(force = false): Promise<void> {
    const stale = Date.now() - this.tribesFetchedAt >= TRIBES_FRESH_FOR;
    if (!currentUser() || (!force && !stale)) return;

    this.tribesFetchedAt = Date.now();
    try {
      this.myTribes = (await tribesApi.list()).filter((tribe) => tribe.is_member);
      this.drawSidebar(currentLocation().path, currentUser());
    } catch {
      // The sidebar keeps its last list.
    }
  }

  private async signOut(): Promise<void> {
    try {
      await account.signOut();
    } finally {
      setUser(null);
      go("/");
      this.onSignedOut();
    }
  }

  /* ── Sidebar ────────────────────────────────────── */

  private navLink(link: NavLink, path: string): HTMLElement {
    const active = isActive(link.path, path);
    return h("a", { href: `#${link.path}`, class: active ? "active" : null, "aria-current": active ? "page" : null }, icon(link.icon), link.label);
  }

  private tribeLinks(path: string): HTMLElement {
    if (!this.myTribes.length) return h("p", { class: "side-empty" }, "None yet. ", h("a", { href: "#/tribes" }, "Find a tribe"));

    const links = this.myTribes.slice(0, SIDEBAR_TRIBES).map((tribe) => {
      const active = path.startsWith(`/tribes/${tribe.id}`);
      return h("a", { class: active ? "side-link active" : "side-link", href: `#/tribes/${tribe.id}` }, h("span", { class: "thumb" }, tribeCover(tribe)), h("span", { class: "ellipsis" }, tribe.name));
    });
    return h("div", { class: "side-nav" }, links);
  }

  private accountRow(user: User): HTMLElement {
    const trigger = h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": "Account menu" }, icon("more"));
    const menu = dropdown(trigger, () => [
      menuItem("user", "Your profile", null, { href: `#/people/${user.id}` }),
      menuItem("calendar", "Events you're going to", null, { href: "#/events?show=going" }),
      "-",
      menuItem("logout", "Sign out", () => void this.signOut(), { class: "menu-danger" }),
    ]);

    return h("div", { class: "account-row" },
      h("a", { href: `#/people/${user.id}`, "aria-label": "Your profile" }, avatar(user, 34)),
      h("div", { class: "grow" }, h("div", { class: "strong small ellipsis" }, user.name), h("div", { class: "tiny muted ellipsis" }, user.email ?? "")),
      menu);
  }

  private drawSidebar(path: string, user: User | null): void {
    const sidebar = element("sidebar");
    sidebar.hidden = !user;
    document.body.classList.toggle("has-sidebar", Boolean(user));
    if (!user) return;

    const createButton = h("button", { type: "button", class: "btn btn-primary" }, icon("plus"), "Create", icon("chevronDown", "sm"));
    const profileActive = path === `/people/${user.id}`;
    const nav = h("nav", { class: "side-nav", "aria-label": "Main" },
      NAV.map((link) => this.navLink(link, path)),
      h("a", { href: `#/people/${user.id}`, class: profileActive ? "active" : null }, icon("user"), "Profile"));

    mount(sidebar,
      logo(),
      h("div", { class: "side-create" }, createMenu(createButton)),
      nav,
      h("div", { class: "side-heading" }, h("span", {}, "Your tribes"), h("a", { href: "#/tribes/new" }, "+ New")),
      this.tribeLinks(path),
      h("div", { class: "side-foot" }, themeSwitch(), this.accountRow(user)));

    sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeDrawer));
  }

  /* ── Header and tab bar ─────────────────────────── */

  private searchForm(path: string, query: URLSearchParams): HTMLElement {
    const input = h("input", { type: "search", placeholder: "Search events, tribes, people, places", "aria-label": "Search", value: path === "/search" ? query.get("q") ?? "" : "" });
    const form = h("form", { class: "header-search", role: "search" }, icon("search"), input, h("kbd", {}, "/"));

    form.addEventListener("submit", (submitted) => {
      submitted.preventDefault();
      const text = input.value.trim();
      if (text) go(`/search?q=${encodeURIComponent(text)}`);
    });
    return form;
  }

  private backButton(path: string): HTMLElement {
    const goBack = () => (this.trail.length > 1 ? history.back() : go(parentOf(path)));
    return h("button", { type: "button", class: "btn btn-ghost btn-sm back-btn", onclick: goBack }, icon("arrowLeft", "sm"), "Back");
  }

  private drawHeader(path: string, query: URLSearchParams, user: User): void {
    const nested = !TOP_LEVEL.has(path);
    const actions = h("div", { class: "header-actions" },
      h("a", { href: "#/search", class: "btn btn-ghost btn-icon mobile-only", "aria-label": "Search" }, icon("search")),
      h("span", { class: "desktop-hidden" }, themeButton()),
      h("a", { class: "desktop-hidden", href: `#/people/${user.id}`, "aria-label": "Your profile" }, avatar(user, 32)));

    mount(element("header"),
      h("button", { type: "button", class: "btn btn-ghost btn-icon desktop-hidden", "aria-label": "Open menu", onclick: openDrawer }, icon("menu")),
      nested ? this.backButton(path) : h("span", { class: "header-logo" }, logo()),
      this.searchForm(path, query),
      actions);
  }

  private drawTabbar(path: string, user: User): void {
    const tabbar = element("tabbar");
    tabbar.hidden = false;

    const tab = (target: string, label: string, iconName: IconName) => h("a", { href: `#${target}`, class: isActive(target, path) ? "active" : null }, icon(iconName), label);
    mount(tabbar,
      tab("/", "Home", "home"),
      tab("/events", "Events", "calendar"),
      createMenu(h("button", { type: "button", class: "tab-create", "aria-label": "Create" }, icon("plus"))),
      tab("/tribes", "Tribes", "users"),
      tab(`/people/${user.id}`, "Profile", "user"));
  }
}
