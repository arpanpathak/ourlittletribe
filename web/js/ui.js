// Small DOM helpers. User text always goes through text nodes, never innerHTML.

/**
 * Builds an element. `attributes` may hold `class`, `on*` handlers, `html`
 * (for static art only), and plain attributes. Children may be strings,
 * nodes, arrays, or null.
 */
export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "html") element.innerHTML = value;
    else if (name.startsWith("on")) element.addEventListener(name.slice(2).toLowerCase(), value);
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

/** Shows a short message at the bottom of the screen. */
export function toast(message, kind = "info") {
  const shelf = document.getElementById("toasts");
  const note = h("div", { class: `toast toast-${kind}`, role: "status" }, message);
  shelf.appendChild(note);
  setTimeout(() => note.classList.add("leaving"), 3200);
  setTimeout(() => note.remove(), 3700);
}

/** "Sat, Nov 7 · 8:00 AM" in the viewer's own time zone. */
export function formatWhen(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
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

/** Initials for an avatar. */
export function initials(name) {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = ["#2f5a45", "#e07a5f", "#4a90a4", "#7a5338", "#8c6bb1", "#c98b2b", "#3f7d64", "#b5566b"];

/** A round avatar with initials, coloured from the name. */
export function avatar(name, size = 32) {
  let hash = 0;
  for (const character of name || "") hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return h("span", { class: "avatar", title: name, style: `--size:${size}px;background:${color}` }, initials(name));
}

/** A button that shows a busy state while `action` runs. */
export function busyButton(label, action, attributes = {}) {
  const button = h("button", { type: "button", ...attributes }, label);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("busy");
    try {
      await action(button);
    } catch (error) {
      toast(error.message || "Something went wrong", "error");
    } finally {
      button.disabled = false;
      button.classList.remove("busy");
    }
  });
  return button;
}

/** Converts a `<input type="datetime-local">` value to Unix seconds. */
export function localInputToUnix(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

/** Unix seconds to a value for `<input type="datetime-local">`. */
export function unixToLocalInput(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** Debounces `action` by `delay` milliseconds. */
export function debounce(action, delay) {
  let timer = null;
  return (...values) => {
    clearTimeout(timer);
    timer = setTimeout(() => action(...values), delay);
  };
}
