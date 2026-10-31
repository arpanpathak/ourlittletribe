// The welcome page: what the app does, and sign in or sign up.

import { api } from "../api.js";
import { skyline, squatch } from "../art.js";
import { h, mount, toast } from "../ui.js";

/** Draws the welcome page; calls `onSignedIn(user)` after a successful sign-in. */
export function renderAuth(view, onSignedIn) {
  let mode = "login";
  const form = h("form", { class: "auth-form card" });

  function draw() {
    const fields = [
      mode === "register" ? h("label", {}, "Name", h("input", { name: "name", required: true, maxlength: 60, autocomplete: "name" })) : null,
      h("label", {}, "Email", h("input", { name: "email", type: "email", required: true, autocomplete: "email" })),
      h("label", {}, "Password",
        h("input", {
          name: "password",
          type: "password",
          required: true,
          minlength: mode === "register" ? 10 : 1,
          autocomplete: mode === "register" ? "new-password" : "current-password",
        })),
    ];
    mount(
      form,
      h("h2", {}, mode === "register" ? "Join the tribe" : "Welcome back"),
      fields,
      h("button", { type: "submit", class: "button primary wide" }, mode === "register" ? "Create account" : "Sign in"),
      h("p", { class: "muted small center" },
        mode === "register" ? "Already have an account? " : "New here? ",
        h("a", {
          href: "#",
          onclick: (event) => {
            event.preventDefault();
            mode = mode === "register" ? "login" : "register";
            draw();
          },
        }, mode === "register" ? "Sign in" : "Create an account")),
    );
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const user = mode === "register"
        ? await api.register(data.get("email"), data.get("name"), data.get("password"))
        : await api.login(data.get("email"), data.get("password"));
      toast(`Hi ${user.name}!`, "success");
      onSignedIn(user);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  draw();

  const features = [
    ["think", "It reads the plan", "Describe the outing. The local model reads it with the forecast, the elevation and your drive, and says what to bring and why."],
    ["map", "Stores on your way", "Search for what you need. The map finds shops along your actual route, ranked by how few minutes they add."],
    ["cheer", "Everyone sees it", "Mark what you've got. The whole group sees who has water, who's bringing the first-aid kit, and what's still missing."],
  ];

  mount(
    view,
    h("section", { class: "welcome" },
      h("div", { class: "welcome-art", html: skyline("dawn") }),
      h("div", { class: "welcome-inner" },
        h("div", { class: "welcome-copy" },
          h("p", { class: "eyebrow" }, "Free · open source · self-hosted"),
          h("h1", {}, "Get your tribe outside."),
          h("p", { class: "lead" }, "Plan hikes, picnics, runs and book clubs with your people. No ads and no paywalls, and the planning model runs on our own hardware."),
        ),
        form,
      ),
    ),
    h("section", { class: "feature-row" },
      features.map(([pose, title, text]) =>
        h("article", { class: "feature card" }, h("div", { class: "feature-art", html: squatch(pose, 90) }), h("h3", {}, title), h("p", {}, text)),
      ),
    ),
  );
}
