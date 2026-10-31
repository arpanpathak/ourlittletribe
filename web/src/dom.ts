// Building elements. Text from people always becomes a text node, never
// markup; the `html` attribute is only for the app's own icons and drawings.

/** Something that can go inside an element: a node, text, a list of them, or nothing. */
export type Child = Node | string | number | null | undefined | false | Child[];

/** An element's attributes. `on*` functions become event listeners. */
export interface Attributes {
  /** The class list, as one string. */
  class?: string | null;
  /** Inline style text. */
  style?: string | null;
  /** The app's own markup, such as an icon; never people's text. */
  html?: string;
  /** An input's value. */
  value?: string;
  /** Any other attribute or `on*` listener. */
  [name: string]: unknown;
}

function setAttribute(element: HTMLElement, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) return;

  if (name === "class") {
    element.className = String(value);
  } else if (name === "html") {
    element.innerHTML = String(value);
  } else if (name === "value" && "value" in element) {
    (element as HTMLInputElement).value = String(value);
  } else if (name.startsWith("on") && typeof value === "function") {
    element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
  } else {
    element.setAttribute(name, value === true ? "" : String(value));
  }
}

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;

    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Builds an element with attributes and children. */
export function h<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    setAttribute(element, name, value);
  }
  append(element, children);
  return element;
}

/** Replaces everything inside `element` with `children`. */
export function mount(element: Element, ...children: Child[]): void {
  element.replaceChildren();
  append(element, children);
}
