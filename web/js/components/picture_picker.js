// Choosing a cover picture: click or drop a file, see it, replace or remove it.

import { h, mount, icon, toast } from "../ui.js";

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 15 * 1024 * 1024;

/** Checks a chosen file before it is uploaded; returns an error message or null. */
export function pictureProblem(file) {
  if (!ACCEPTED.split(",").includes(file.type)) return "Choose a JPEG, PNG, WebP or GIF picture";
  if (file.size > MAX_BYTES) return "That picture is larger than 15 MB";
  return null;
}

/** Opens the file chooser; resolves with the files picked (possibly none). */
export function choosePictures(multiple = false) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ACCEPTED, multiple: multiple ? true : null, hidden: true });
    input.addEventListener("change", () => {
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * A drop area for one picture. `existingUrl` shows the current cover.
 * `value()` returns `{ file }` for a new picture, `{ removed: true }` if the
 * current one was removed, or null if nothing changed.
 */
export function picturePicker({ existingUrl = null, hint = "A wide landscape picture works best, at least 1600 px across." } = {}) {
  let file = null;
  let removed = false;
  let previewUrl = null;
  const zone = h("div", { class: "dropzone", tabindex: "0", role: "button", "aria-label": "Choose a cover picture" });

  function shownUrl() {
    if (previewUrl) return previewUrl;
    if (existingUrl && !removed) return existingUrl;
    return null;
  }

  function draw() {
    const url = shownUrl();
    if (url) {
      mount(zone,
        h("img", { src: url, alt: "Cover preview" }),
        h("div", { class: "dz-actions" },
          h("button", { type: "button", class: "btn btn-sm btn-overlay", onclick: (event) => { event.stopPropagation(); pick(); } }, icon("image", "sm"), "Replace"),
          h("button", {
            type: "button",
            class: "btn btn-sm btn-overlay",
            onclick: (event) => {
              event.stopPropagation();
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              previewUrl = null;
              file = null;
              removed = Boolean(existingUrl);
              draw();
            },
          }, icon("trash", "sm"), "Remove")));
    } else {
      mount(zone, h("div", { class: "dz-text" }, icon("image"), h("strong", {}, "Add a cover picture"), h("span", { class: "small muted" }, "Click to choose, or drop a file here"), h("span", { class: "tiny muted" }, hint)));
    }
  }

  function accept(chosen) {
    if (!chosen) return;
    const problem = pictureProblem(chosen);
    if (problem) {
      toast(problem, "error");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    file = chosen;
    removed = false;
    previewUrl = URL.createObjectURL(chosen);
    draw();
  }

  async function pick() {
    const [chosen] = await choosePictures(false);
    accept(chosen);
  }

  zone.addEventListener("click", pick);
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick();
    }
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("over");
    accept(event.dataTransfer.files[0]);
  });
  draw();

  return {
    element: zone,
    value: () => (file ? { file } : removed ? { removed: true } : null),
  };
}
