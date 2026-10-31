// Drop-down menus.

import { h } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/** A menu entry, or a dividing line. */
export type MenuEntry = HTMLElement | "-";

/** Optional parts of a menu entry. */
export interface MenuItemOptions {
  /** Makes it a link to this address. */
  href?: string;
  /** Extra classes, such as "menu-danger". */
  class?: string;
  /** Where a link opens, such as "_blank". */
  target?: string;
  /** Link relations, such as "noopener". */
  rel?: string;
}

/** A menu entry: a link when `options.href` is given, else a button calling `onClick`. */
export function menuItem(iconName: IconName, label: string, onClick: (() => void) | null, options: MenuItemOptions = {}): HTMLElement {
  const content = [icon(iconName), label];
  if (options.href) {
    return h("a", { role: "menuitem", href: options.href, class: options.class, target: options.target, rel: options.rel }, content);
  }
  return h("button", { type: "button", role: "menuitem", class: options.class, onclick: onClick }, content);
}

/** A menu that opens under `trigger`. Entries are built each time it opens. */
export function dropdown(trigger: HTMLElement, buildEntries: () => MenuEntry[]): HTMLElement {
  const wrap = h("div", { class: "menu-wrap" }, trigger);
  let menu: HTMLElement | null = null;

  function close(): void {
    menu?.remove();
    menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeWhenOutside, true);
    document.removeEventListener("keydown", closeOnEscape);
  }

  function closeWhenOutside(event: MouseEvent): void {
    if (!wrap.contains(event.target as Node)) close();
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }

  function open(): void {
    const entries = buildEntries().map((entry) => (entry === "-" ? h("hr") : entry));
    menu = h("div", { class: "menu", role: "menu" }, entries);
    menu.addEventListener("click", (clicked) => {
      if ((clicked.target as Element).closest("a, button")) setTimeout(close, 0);
    });

    wrap.appendChild(menu);
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", closeWhenOutside, true);
    document.addEventListener("keydown", closeOnEscape);
  }

  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (menu) close();
    else open();
  });

  return wrap;
}
