// Form fields and buttons used across pages.

import { h, mount, type Child } from "../dom.js";
import { icon, type IconName } from "../icons.js";
import { errorMessage, toast } from "./feedback.js";

/**
 * A button that shows a spinner while `action` runs, and reports a failure
 * as a message. Other attributes are passed to the button.
 */
export function actionButton(label: Child, action: (button: HTMLButtonElement) => Promise<void>, attributes: Record<string, unknown> = {}): HTMLButtonElement {
  const button = h("button", { type: "button", ...attributes }, label);

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;

    const content = [...button.childNodes];
    button.style.minWidth = `${button.offsetWidth}px`;
    button.disabled = true;
    button.classList.add("busy");
    button.replaceChildren(h("span", { class: "spinner" }));

    try {
      await action(button);
    } catch (error) {
      toast(errorMessage(error), "error");
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

/** One choice of a segmented control or tab bar. */
export interface Choice<Value extends string> {
  /** Its value. */
  value: Value;
  /** What it says. */
  label: string;
  /** An icon before the label. */
  icon?: IconName;
  /** A number after the label, such as how many items. */
  count?: number;
}

/** A row of buttons where one is chosen; calls `onChange` with the new value. */
export function segmented<Value extends string>(choices: Choice<Value>[], current: Value, onChange: (value: Value) => void, label: string): HTMLElement {
  const group = h("div", { class: "segmented", role: "group", "aria-label": label });

  function draw(active: Value): void {
    const buttons = choices.map((choice) => {
      const select = () => {
        draw(choice.value);
        onChange(choice.value);
      };
      const pressed = choice.value === active ? "true" : "false";
      return h("button", { type: "button", "aria-pressed": pressed, onclick: select }, choice.icon ? icon(choice.icon, "sm") : null, choice.label);
    });
    mount(group, buttons);
  }

  draw(current);
  return group;
}

/** Underlined tabs; calls `onChange` with the new value. */
export function tabBar<Value extends string>(choices: Choice<Value>[], current: Value, onChange: (value: Value) => void): HTMLElement {
  const bar = h("div", { class: "tabs", role: "tablist" });

  function draw(active: Value): void {
    const tabs = choices.map((choice) => {
      const select = () => {
        draw(choice.value);
        onChange(choice.value);
      };
      const selected = choice.value === active ? "true" : "false";
      const badge = choice.count === undefined ? null : h("span", { class: "count" }, String(choice.count));
      return h("button", { type: "button", role: "tab", "aria-selected": selected, onclick: select }, choice.label, badge);
    });
    mount(bar, tabs);
  }

  draw(current);
  return bar;
}

/** A labelled field that can show an error or a confirmation under it. */
export interface Field {
  /** The field, to put in a form. */
  element: HTMLElement;
  /** Shows a problem, or clears it with null. */
  setError: (text: string | null) => void;
  /** Shows that the value is fine. */
  setOk: (text: string) => void;
}

/** Optional parts of a field. */
export interface FieldOptions {
  /** A line of help under the control. */
  hint?: string;
  /** What to show in place of the control, such as the control with a button beside it. */
  wrap?: HTMLElement;
}

let nextFieldId = 0;

/** A labelled form field around `control`. */
export function field(label: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, options: FieldOptions = {}): Field {
  nextFieldId += 1;
  control.id ||= `field-${nextFieldId}`;

  const hint = options.hint ?? "";
  const message = h("div", { class: "hint" }, hint);
  message.hidden = !hint;
  const element = h("div", { class: "field" }, h("label", { for: control.id }, label), options.wrap ?? control, message);

  return {
    element,
    setError(text) {
      control.setAttribute("aria-invalid", text ? "true" : "false");
      message.className = text ? "error" : "hint";
      message.textContent = text ?? hint;
      message.hidden = !text && !hint;
    },
    setOk(text) {
      control.setAttribute("aria-invalid", "false");
      message.className = "ok";
      message.textContent = text;
      message.hidden = false;
    },
  };
}

/** A label above something that is not a single input, such as an editor. */
export function labelled(label: string, content: Child, hint: string | null = null): HTMLElement {
  return h("div", { class: "field" }, h("span", { class: "field-label" }, label), content, hint ? h("div", { class: "hint" }, hint) : null);
}

/** Runs `action` only once calls stop for `delay` milliseconds. */
export function debounce<Arguments extends unknown[]>(action: (...values: Arguments) => void, delay: number): (...values: Arguments) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...values) => {
    clearTimeout(timer);
    timer = setTimeout(() => action(...values), delay);
  };
}

/** Copies text and says so. */
export async function copyText(text: string, done = "Link copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, "success");
  } catch {
    window.prompt("Copy this link", text);
  }
}
