// Sign in and create an account.

import { api } from "../api.js";
import { h, mount, icon, iconMarkup, field } from "../ui.js";

const MIN_PASSWORD = 10;

/** 0–4: how hard a password looks to guess, for the strength bar. */
function strengthOf(password) {
  if (password.length < MIN_PASSWORD) return password ? 1 : 0;
  let level = 2;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (kinds >= 3 || password.length >= 14) level = 3;
  if (kinds >= 3 && password.length >= 14) level = 4;
  return level;
}

const STRENGTH_WORDS = ["", "Too short", "Okay", "Good", "Strong"];

function passwordInput(name, autocomplete, placeholder) {
  const input = h("input", { name, type: "password", autocomplete, placeholder, required: true });
  const toggle = h("button", {
    type: "button",
    class: "btn btn-ghost btn-icon btn-sm input-end",
    "aria-label": "Show password",
    html: iconMarkup("eye"),
    onclick: () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.innerHTML = iconMarkup(showing ? "eye" : "eyeOff");
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    },
  });
  return { input, wrap: h("div", { class: "input-wrap has-end" }, input, toggle) };
}

/** Draws the sign-in page; calls `onSignedIn(user)` once signed in. */
export function renderAuth(view, onSignedIn) {
  let mode = "signin";
  const card = h("div", { class: "auth-card" });

  function draw() {
    const creating = mode === "create";
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

    function checkStrength() {
      const level = strengthOf(password.input.value);
      meter.dataset.level = String(level);
      meterLabel.textContent = STRENGTH_WORDS[level];
    }

    function checkMatch(final = false) {
      if (!confirm.input.value) {
        confirmField.setError(final ? "Type the password again" : null);
        return !final;
      }
      if (confirm.input.value !== password.input.value) {
        confirmField.setError("Passwords don't match");
        return false;
      }
      confirmField.setOk("Passwords match");
      return true;
    }

    if (creating) {
      password.input.addEventListener("input", () => {
        checkStrength();
        if (confirm.input.value) checkMatch();
        passwordField.setError(null);
      });
      confirm.input.addEventListener("input", () => checkMatch());
    }

    const submit = h("button", { type: "submit", class: "btn btn-primary btn-lg btn-block" }, creating ? "Create account" : "Sign in");
    const form = h("form", { novalidate: true },
      formError,
      creating ? nameField : null,
      emailField,
      passwordField,
      creating ? h("div", { class: "row-between", style: "margin-top:-8px" }, h("div", { style: "flex:1;max-width:200px" }, meter), meterLabel) : null,
      creating ? confirmField : null,
      submit);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      formError.hidden = true;
      let valid = true;
      if (creating && !name.value.trim()) {
        nameField.setError("Enter your name");
        valid = false;
      } else nameField.setError(null);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        emailField.setError("Enter a valid email address");
        valid = false;
      } else emailField.setError(null);
      if (creating && password.input.value.length < MIN_PASSWORD) {
        passwordField.setError(`Use at least ${MIN_PASSWORD} characters`);
        valid = false;
      } else if (!password.input.value) {
        passwordField.setError("Enter your password");
        valid = false;
      } else passwordField.setError(null);
      if (creating && !checkMatch(true)) valid = false;
      if (!valid) {
        form.querySelector('[aria-invalid="true"]')?.focus();
        return;
      }
      submit.disabled = true;
      submit.replaceChildren(h("span", { class: "spinner" }), creating ? "Creating account…" : "Signing in…");
      try {
        const user = creating
          ? await api.register(email.value.trim(), name.value.trim(), password.input.value)
          : await api.login(email.value.trim(), password.input.value);
        onSignedIn(user);
      } catch (error) {
        mount(formError, icon("alert"), h("span", {}, error.message));
        formError.hidden = false;
        submit.disabled = false;
        submit.replaceChildren(creating ? "Create account" : "Sign in");
      }
    });

    mount(card,
      h("div", {},
        h("h2", {}, creating ? "Create your account" : "Welcome back"),
        h("p", { class: "muted", style: "margin-top:6px" }, creating ? "It's free. The first account on a new server becomes its admin." : "Sign in to see your tribes and plans.")),
      form,
      h("p", { class: "auth-switch" },
        creating ? "Already have an account? " : "New to OurLittleTribe? ",
        h("button", {
          type: "button",
          onclick: () => {
            mode = creating ? "signin" : "create";
            draw();
          },
        }, creating ? "Sign in" : "Create an account")));
    (creating ? name : email).focus();
  }

  const points = [
    ["calendar", "Plan outings together", "Pick a place on the map, set a time, and see who's coming."],
    ["sparkles", "A packing list that thinks", "A local model reads the plan, the forecast and the drive, and suggests what to bring."],
    ["route", "Stores on your way", "Find shops along your actual route that sell what you still need."],
  ];

  view.classList.remove("page");
  mount(view,
    h("div", { class: "auth" },
      h("aside", { class: "auth-aside" },
        h("h1", {}, "Get your people outside."),
        h("p", { class: "lead" }, "OurLittleTribe is a free, self-hosted way to plan hikes, picnics, runs and meetups with the people you like."),
        h("ul", { class: "auth-points" }, points.map(([iconName, title, text]) =>
          h("li", {}, h("span", { class: "info-icon" }, icon(iconName)), h("div", {}, h("b", {}, title), h("p", {}, text)))))),
      h("div", { class: "auth-main" }, card)));
  draw();
}
