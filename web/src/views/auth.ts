// Sign in and create an account.

import { account } from "../api/client.js";
import type { User } from "../api/types.js";
import { heroScene } from "../art.js";
import { h, mount } from "../dom.js";
import { icon, iconMarkup, type IconName } from "../icons.js";
import { field, type Field } from "../ui/controls.js";
import { errorMessage } from "../ui/feedback.js";

const MIN_PASSWORD = 10;

/** How hard a password looks to guess, for the strength bar. */
type Strength = 0 | 1 | 2 | 3 | 4;

const STRENGTH_WORDS: Record<Strength, string> = { 0: "", 1: "Too short", 2: "Okay", 3: "Good", 4: "Strong" };

/** Whether the card signs in or makes an account. */
type Mode = "sign_in" | "create";

/** A reason to sign up, beside the form. */
interface SellingPoint {
  /** Its icon. */
  icon: IconName;
  /** The headline. */
  title: string;
  /** A sentence about it. */
  text: string;
}

const SELLING_POINTS: SellingPoint[] = [
  { icon: "calendar", title: "Plan outings together", text: "Pick a place on the map, set a time, and see who's coming." },
  { icon: "sparkles", title: "A packing list that thinks", text: "A local model reads the plan, the forecast and the drive, and suggests what to bring." },
  { icon: "route", title: "Stores on your way", text: "Find shops along your actual route that sell what you still need." },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strengthOf(password: string): Strength {
  if (password.length < MIN_PASSWORD) return password ? 1 : 0;

  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const varied = kinds >= 3;
  const long = password.length >= 14;

  if (varied && long) return 4;
  if (varied || long) return 3;
  return 2;
}

/** A password box with a show/hide button. */
interface PasswordInput {
  /** The input. */
  input: HTMLInputElement;
  /** The input with its button. */
  wrap: HTMLElement;
}

function passwordInput(name: string, autocomplete: string, placeholder: string): PasswordInput {
  const input = h("input", { name, type: "password", autocomplete, placeholder, required: true });
  const toggle = h("button", { type: "button", class: "btn btn-ghost btn-icon btn-sm input-end", "aria-label": "Show password", html: iconMarkup("eye") });

  toggle.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.innerHTML = iconMarkup(showing ? "eye" : "eyeOff");
    toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
  return { input, wrap: h("div", { class: "input-wrap has-end" }, input, toggle) };
}

/** Shows `problem` on `target`, or clears it; returns whether the value was fine. */
function check(target: Field, problem: string | null): boolean {
  target.setError(problem);
  return problem === null;
}

/** The sign-in or sign-up card. */
class AuthCard {
  /** The card. */
  readonly element = h("div", { class: "auth-card" });

  /** Which form is showing. */
  private mode: Mode = "sign_in";

  constructor(private readonly onSignedIn: (user: User) => void) {
    this.draw();
  }

  private switchMode(): void {
    this.mode = this.mode === "create" ? "sign_in" : "create";
    this.draw();
  }

  private draw(): void {
    const creating = this.mode === "create";

    const formError = h("div", { class: "form-error", hidden: true });
    const name = h("input", { name: "name", autocomplete: "name", maxlength: 60, placeholder: "Your name", required: true });
    const email = h("input", { name: "email", type: "email", autocomplete: "email", placeholder: "you@example.com", required: true });
    const password = passwordInput("password", creating ? "new-password" : "current-password", creating ? `At least ${MIN_PASSWORD} characters` : "Your password");
    const confirm = passwordInput("confirm", "new-password", "Type it again");

    const nameField = field("Name", name);
    const emailField = field("Email", email);
    const passwordField = field("Password", password.input, { wrap: password.wrap });
    const confirmField = field("Confirm password", confirm.input, { wrap: confirm.wrap });

    const meter = h("div", { class: "strength", "data-level": "0" }, h("span"), h("span"), h("span"), h("span"));
    const meterLabel = h("span", { class: "tiny muted" });
    const meterRow = h("div", { class: "strength-row" }, meter, meterLabel);

    const passwordsMatch = (final: boolean): boolean => {
      if (!confirm.input.value) return check(confirmField, final ? "Type the password again" : null) || !final;
      if (confirm.input.value !== password.input.value) return check(confirmField, "Passwords don't match");

      confirmField.setOk("Passwords match");
      return true;
    };

    if (creating) {
      password.input.addEventListener("input", () => {
        const level = strengthOf(password.input.value);
        meter.dataset.level = String(level);
        meterLabel.textContent = STRENGTH_WORDS[level];
        passwordField.setError(null);
        if (confirm.input.value) passwordsMatch(false);
      });
      confirm.input.addEventListener("input", () => passwordsMatch(false));
    }

    const passwordProblem = (): string | null => {
      if (creating && password.input.value.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
      if (!password.input.value) return "Enter your password";
      return null;
    };

    const valid = (): boolean => {
      const checks = [
        check(nameField, creating && !name.value.trim() ? "Enter your name" : null),
        check(emailField, EMAIL.test(email.value.trim()) ? null : "Enter a valid email address"),
        check(passwordField, passwordProblem()),
        creating ? passwordsMatch(true) : true,
      ];
      return checks.every(Boolean);
    };

    const submitLabel = creating ? "Create account" : "Sign in";
    const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg btn-block" }, submitLabel);
    const form = h("form", { novalidate: true },
      formError,
      creating ? nameField.element : null,
      emailField.element,
      passwordField.element,
      creating ? meterRow : null,
      creating ? confirmField.element : null,
      submit);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      formError.hidden = true;

      if (!valid()) {
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        return;
      }

      submit.disabled = true;
      submit.replaceChildren(h("span", { class: "spinner" }), creating ? "Creating account…" : "Signing in…");
      try {
        const user = creating
          ? await account.create(email.value.trim(), name.value.trim(), password.input.value)
          : await account.signIn(email.value.trim(), password.input.value);
        this.onSignedIn(user);
      } catch (error) {
        mount(formError, icon("alert"), h("span", {}, errorMessage(error)));
        formError.hidden = false;
        submit.disabled = false;
        submit.replaceChildren(submitLabel);
      }
    });

    const intro = h("div", {},
      h("h2", {}, creating ? "Create your account" : "Welcome back"),
      h("p", { class: "muted auth-intro" }, creating ? "It's free. The first account on a new server becomes its admin." : "Sign in to see your tribes and plans."));
    const switcher = h("p", { class: "auth-switch" },
      creating ? "Already have an account? " : "New to OurLittleTribe? ",
      h("button", { type: "button", onclick: () => this.switchMode() }, creating ? "Sign in" : "Create an account"));

    mount(this.element, intro, form, switcher);
    (creating ? name : email).focus();
  }
}

function sellingPoint(point: SellingPoint): HTMLElement {
  return h("li", {}, h("span", { class: "info-icon" }, icon(point.icon)), h("div", {}, h("b", {}, point.title), h("p", {}, point.text)));
}

/** Draws the sign-in page; calls `onSignedIn` once signed in. */
export function renderAuth(view: HTMLElement, onSignedIn: (user: User) => void): void {
  const aside = h("aside", { class: "auth-aside" },
    h("div", { class: "auth-scene", html: heroScene() }),
    h("h1", {}, "Get your people outside."),
    h("p", { class: "lead" }, "OurLittleTribe is a free, self-hosted way to plan hikes, picnics, runs and meetups with the people you like."),
    h("ul", { class: "auth-points" }, SELLING_POINTS.map(sellingPoint)));

  view.classList.remove("page");
  mount(view, h("div", { class: "auth" }, aside, h("div", { class: "auth-main" }, new AuthCard(onSignedIn).element)));
}
