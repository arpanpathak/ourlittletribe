// Small DOM helpers and shared pieces. User text always goes through text
// nodes, never innerHTML; `html` is only used for the app's own icon markup.

import { icon, iconMarkup } from "./icons.js";
import { spotFor } from "./art.js";

/**
 * Builds an element. `attributes` may hold `class`, `on*` handlers, `html`
 * (for static markup only), `style`, and plain attributes. Children may be
 * strings, nodes, arrays, or null.
 */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "html") element.innerHTML = value;
    else if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "value") element.value = value;
    else element.setAttribute(name, value === true ? "" : value);
  }
  appendAll(element, children);
  return element;
}

function appendAll(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendAll(element, child);
    else if (child instanceof Node) element.appendChild(child);
    else element.appendChild(document.createTextNode(String(child)));
  }
}

/** Replaces everything inside `element` with `children`. */
export function mount(element, ...children) {
  element.replaceChildren();
  appendAll(element, children);
}

export { icon };

/** Shows a short message in the corner. `kind` is `info`, `success` or `error`. */
export function toast(message, kind = "info") {
  const shelf = document.getElementById("toasts");
  const symbol = { success: "check", error: "alert", info: "info" }[kind] || "info";
  const note = h("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" }, icon(symbol), h("span", {}, message));
  shelf.appendChild(note);
  setTimeout(() => note.classList.add("leaving"), 3600);
  setTimeout(() => note.remove(), 4000);
}

/* ── Dates ─────────────────────────────────────────── */

const toDate = (unixSeconds) => new Date(unixSeconds * 1000);

/** "Sat, Nov 7" */
export function formatDay(unixSeconds) {
  return toDate(unixSeconds).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Saturday, November 7, 2026" */
export function formatLongDay(unixSeconds) {
  return toDate(unixSeconds).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "8:00 AM" */
export function formatTime(unixSeconds) {
  return toDate(unixSeconds).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Sat, Nov 7 · 8:00 AM" */
export function formatWhen(unixSeconds) {
  return `${formatDay(unixSeconds)} · ${formatTime(unixSeconds)}`;
}

/** Month and day for a calendar chip. */
export function dateParts(unixSeconds) {
  const date = toDate(unixSeconds);
  return { month: date.toLocaleDateString(undefined, { month: "short" }), day: String(date.getDate()) };
}

/** "in 3 days", "tomorrow", "2 hours ago". */
export function relativeTime(unixSeconds) {
  const seconds = unixSeconds - Date.now() / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];
  let divisor = 1;
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) return format.format(Math.round(seconds / divisor), unit);
    divisor = limit;
  }
  return format.format(Math.round(seconds / 31557600), "year");
}

/** "Today", "Tomorrow", "This Saturday" or "Sat, Nov 14", for grouping a list by day. */
export function dayHeading(unixSeconds) {
  const date = toDate(unixSeconds);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** A `<input type="date">` value and a `<input type="time">` value for Unix seconds. */
export function dateAndTimeInputs(unixSeconds) {
  const date = toDate(unixSeconds);
  const pad = (number) => String(number).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/** Unix seconds from date and time input values, in the viewer's time zone. */
export function unixFromInputs(dateValue, timeValue) {
  return Math.floor(new Date(`${dateValue}T${timeValue || "00:00"}`).getTime() / 1000);
}

/* ── People and pictures ───────────────────────────── */

/** Initials for an avatar. */
export function initials(name) {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function hashOf(text) {
  let hash = 0;
  for (const character of text || "") hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

const AVATAR_COLORS = ["#2f6f55", "#b4532a", "#2d6a9f", "#7a5338", "#6b4fa0", "#a8741a", "#3d7d6a", "#a2445e"];

/** A round avatar: the person's picture when they have one, else initials coloured from the name. */
export function avatar(name, size = 32, picture = null) {
  const color = AVATAR_COLORS[hashOf(name) % AVATAR_COLORS.length];
  if (picture) {
    return h("span", { class: "avatar has-picture", title: name, style: `--size:${size}px` },
      h("img", { src: pictureUrl(picture, true), alt: "", loading: "lazy", decoding: "async" }));
  }
  return h("span", { class: "avatar", title: name, style: `--size:${size}px;background:${color}` }, initials(name));
}

/** Up to `max` overlapping avatars, then "+n". `people` are `{ name, avatar }`. */
export function avatarStack(people, size = 28, max = 5) {
  const shown = people.slice(0, max).map((person) => avatar(person.name, size, person.avatar));
  if (people.length > max) {
    shown.push(h("span", { class: "avatar avatar-more", style: `--size:${size}px` }, `+${people.length - max}`));
  }
  return h("div", { class: "avatar-stack" }, shown);
}

/** The URL of an uploaded picture; `small` is the 560-pixel copy. */
export function pictureUrl(id, small = false) {
  return `media/${id}${small ? "_s" : ""}.jpg`;
}

/** A calm two-tone gradient picked from `seed`, for tribes without a cover. */
export function gradientFor(seed) {
  const hue = hashOf(seed) % 360;
  return `background: linear-gradient(135deg, hsl(${hue} 32% 34%), hsl(${(hue + 40) % 360} 38% 22%));`;
}

const TILE_ZOOM = 12;

/**
 * A small map centred on a point, from three-by-two OpenStreetMap tiles;
 * used as the picture for events without a cover.
 */
export function mapThumb(lat, lng, zoom = TILE_ZOOM) {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const radians = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const offsetX = (x - tileX) * 256;
  const offsetY = (y - tileY) * 256;
  const firstRow = offsetY < 128 ? tileY - 1 : tileY;
  const tiles = [];
  for (let row = firstRow; row < firstRow + 2; row += 1) {
    for (let column = tileX - 1; column <= tileX + 1; column += 1) {
      const wrapped = ((column % scale) + scale) % scale;
      tiles.push(h("img", { src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${row}.png`, alt: "", loading: "lazy", decoding: "async" }));
    }
  }
  const pointX = 256 + offsetX;
  const pointY = (tileY - firstRow) * 256 + offsetY;
  return h("div", { class: "map-thumb" },
    h("div", { class: "map-thumb-tiles", style: `left: calc(50% - ${pointX.toFixed(1)}px); top: calc(50% - ${pointY.toFixed(1)}px);` }, tiles),
    h("span", { class: "map-thumb-pin", html: '<svg viewBox="0 0 24 24"><path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="10" r="2.6" fill="#fff" stroke="none"/></svg>' }));
}

/** The picture area of an event: its cover, or a map of where it meets. */
export function eventCover(event, { small = true, className = "" } = {}) {
  return h("div", { class: `cover ${className}` },
    event.cover_image
      ? h("img", { src: pictureUrl(event.cover_image, small), alt: "", loading: "lazy", decoding: "async" })
      : mapThumb(event.lat, event.lng));
}

/** The picture area of a tribe: its cover, or a gradient with its initials. */
export function tribeCover(tribe, { small = true, className = "" } = {}) {
  return h("div", { class: `cover ${className}` },
    tribe.cover_image
      ? h("img", { src: pictureUrl(tribe.cover_image, small), alt: "", loading: "lazy", decoding: "async" })
      : h("div", { class: "cover-fallback", style: gradientFor(tribe.id) }, h("span", { class: "monogram" }, initials(tribe.name))));
}

/* ── Controls ──────────────────────────────────────── */

/**
 * A button that shows a spinner while `action` runs and reports failures.
 * `label` may be text or an array of nodes.
 */
export function actionButton(label, action, attributes = {}) {
  const button = h("button", { type: "button", ...attributes }, label);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    const content = [...button.childNodes];
    const width = button.offsetWidth;
    button.disabled = true;
    button.classList.add("busy");
    if (width) button.style.minWidth = `${width}px`;
    button.replaceChildren(h("span", { class: "spinner" }));
    try {
      await action(button);
    } catch (error) {
      toast(error.message || "Something went wrong", "error");
    } finally {
      if (button.isConnected) {
        button.replaceChildren(...content);
        button.disabled = false;
        button.classList.remove("busy");
        button.style.minWidth = "";
      }
    }
  });
  return button;
}

/** A row of mutually exclusive buttons; calls `onChange(value)`. */
export function segmented(options, current, onChange, label) {
  const group = h("div", { class: "segmented", role: "group", "aria-label": label });
  function draw(active) {
    mount(group, options.map(([value, text, iconName]) =>
      h("button", {
        type: "button",
        "aria-pressed": value === active ? "true" : "false",
        onclick: () => {
          draw(value);
          onChange(value);
        },
      }, iconName ? icon(iconName, "sm") : null, text)));
  }
  draw(current);
  return group;
}

/** Underlined tabs; `tabs` is a list of [value, label, count]. */
export function tabBar(tabs, current, onChange) {
  const bar = h("div", { class: "tabs", role: "tablist" });
  function draw(active) {
    mount(bar, tabs.map(([value, text, count]) =>
      h("button", {
        type: "button",
        role: "tab",
        "aria-selected": value === active ? "true" : "false",
        onclick: () => {
          draw(value);
          onChange(value);
        },
      }, text, count !== undefined && count !== null ? h("span", { class: "count" }, String(count)) : null)));
  }
  draw(current);
  return bar;
}

/** An empty state: a small illustration (or an icon), a title, a sentence, and optional actions. */
export function emptyState(iconName, title, text, ...actions) {
  const scene = spotFor(iconName);
  return h("div", { class: "empty" },
    scene ? h("div", { html: scene }) : h("div", { class: "empty-icon" }, icon(iconName)),
    h("h3", {}, title),
    text ? h("p", {}, text) : null,
    actions.length ? h("div", { class: "row" }, actions) : null);
}

/**
 * A labelled form field around `control`. `wrap` is an element holding the
 * control (such as an input with a button) to show in its place.
 */
export function field(label, control, { hint = null, id = null, wrap = null } = {}) {
  const controlId = id || control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = controlId;
  const message = h("div", { class: "hint" }, hint || "");
  if (!hint) message.hidden = true;
  const wrapper = h("div", { class: "field" }, h("label", { for: controlId }, label), wrap || control, message);
  wrapper.setError = (text) => {
    control.setAttribute("aria-invalid", text ? "true" : "false");
    message.className = text ? "error" : "hint";
    message.textContent = text || hint || "";
    message.hidden = !text && !hint;
  };
  wrapper.setOk = (text) => {
    control.setAttribute("aria-invalid", "false");
    message.className = "ok";
    message.textContent = text;
    message.hidden = false;
  };
  return wrapper;
}

/** A drop-down menu opened by `trigger`; `items` are nodes (links or buttons) or "-" for a line. */
export function dropdown(trigger, buildItems) {
  const wrap = h("div", { class: "menu-wrap" }, trigger);
  let menu = null;
  function close() {
    menu?.remove();
    menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true);
    document.removeEventListener("keydown", escape);
  }
  function outside(event) {
    if (!wrap.contains(event.target)) close();
  }
  function escape(event) {
    if (event.key === "Escape") close();
  }
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    if (menu) {
      close();
      return;
    }
    const items = buildItems().map((item) => (item === "-" ? h("hr") : item));
    menu = h("div", { class: "menu", role: "menu" }, items);
    menu.addEventListener("click", (clicked) => {
      if (clicked.target.closest("a, button")) setTimeout(close, 0);
    });
    wrap.appendChild(menu);
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape);
  });
  return wrap;
}

/** A menu entry. */
export function menuItem(iconName, label, onClick, attributes = {}) {
  return h(attributes.href ? "a" : "button", { type: attributes.href ? null : "button", role: "menuitem", onclick: onClick, ...attributes }, icon(iconName), label);
}

/**
 * Opens a modal dialog. `build(close)` returns the body; `actions` are
 * buttons for the footer. Resolves with what `close(value)` was given.
 */
export function openModal({ title, build, actions = () => [], wide = false }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "modal", style: wide ? "max-width:min(760px, calc(100vw - 24px))" : null });
    let result;
    const close = (value) => {
      result = value;
      dialog.close();
    };
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(undefined);
    });
    const body = build(close);
    dialog.appendChild(
      h("div", { class: "modal-box" },
        h("div", { class: "modal-head" }, h("h2", {}, title),
          h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm", "aria-label": "Close", onclick: () => close(undefined) }, icon("x"))),
        h("div", { class: "modal-body" }, body),
        (() => {
          const buttons = actions(close);
          return buttons.length ? h("div", { class: "modal-foot" }, buttons) : null;
        })()));
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/** Asks a yes-or-no question; resolves true for yes. */
export function confirmAction(title, text, confirmLabel = "Confirm", danger = false) {
  return openModal({
    title,
    build: () => h("p", { class: "text-2" }, text),
    actions: (close) => [
      h("button", { type: "button", class: "btn", onclick: () => close(false) }, "Cancel"),
      h("button", {
        type: "button",
        class: "btn btn-primary",
        style: danger ? "background:var(--danger);border-color:var(--danger);color:#fff" : null,
        onclick: () => close(true),
      }, confirmLabel),
    ],
  }).then(Boolean);
}

/** Debounces `action` by `delay` milliseconds. */
export function debounce(action, delay) {
  let timer = null;
  return (...values) => {
    clearTimeout(timer);
    timer = setTimeout(() => action(...values), delay);
  };
}

/** A loading placeholder for a page. */
export function loadingPage() {
  return h("div", { class: "loading-page" },
    h("div", { class: "skeleton", style: "height:36px;width:40%" }),
    h("div", { class: "skeleton", style: "height:220px" }),
    h("div", { class: "skeleton", style: "height:120px" }));
}

/** Copies `text` and confirms with a toast. */
export async function copyText(text, done = "Link copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, "success");
  } catch {
    window.prompt("Copy this link", text);
  }
}

export { iconMarkup };
