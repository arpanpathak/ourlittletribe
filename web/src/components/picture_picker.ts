// Choosing a picture: a file chooser, checks before upload, and a drop area
// for a cover that shows the current picture and can replace or remove it.

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { toast } from "../ui/feedback.js";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MOST_BYTES = 15 * 1024 * 1024;

/** What is wrong with a chosen file, or null when it can be uploaded. */
export function pictureProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Choose a JPEG, PNG, WebP or GIF picture";
  if (file.size > MOST_BYTES) return "That picture is larger than 15 MB";
  return null;
}

/** Opens the file chooser; resolves with the files picked, possibly none. */
export function choosePictures(multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept: ACCEPTED_TYPES.join(","), multiple: multiple ? true : null, hidden: true });
    const finish = (files: File[]) => {
      resolve(files);
      input.remove();
    };

    input.addEventListener("change", () => finish([...(input.files ?? [])]));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** What happened to a cover in the picker. */
export type CoverChange = { kind: "new"; file: File } | { kind: "removed" } | { kind: "unchanged" };

/** A cover drop area. */
export interface PicturePicker {
  /** The area, to put in a form. */
  element: HTMLElement;
  /** What the person did. */
  change: () => CoverChange;
  /** Shows a picture made elsewhere, such as a generated cover, as the new cover. */
  use: (file: File) => void;
  /** The address of the picture showing now, or null when there is none. */
  shown: () => string | null;
}

/** A drop area for one cover picture; `existingUrl` is the current cover. */
export function picturePicker(existingUrl: string | null, hint = "A wide landscape picture works best, at least 1600 px across."): PicturePicker {
  let change: CoverChange = { kind: "unchanged" };
  let previewUrl: string | null = null;
  const zone = h("div", { class: "dropzone", tabindex: "0", role: "button", "aria-label": "Choose a cover picture" });

  function shownUrl(): string | null {
    switch (change.kind) {
      case "new":
        return previewUrl;
      case "removed":
        return null;
      case "unchanged":
        return existingUrl;
    }
  }

  function clearPreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function accept(file: File | undefined): void {
    if (!file) return;
    const problem = pictureProblem(file);
    if (problem) {
      toast(problem, "error");
      return;
    }

    clearPreview();
    previewUrl = URL.createObjectURL(file);
    change = { kind: "new", file };
    draw();
  }

  async function pick(): Promise<void> {
    const [file] = await choosePictures(false);
    accept(file);
  }

  function remove(): void {
    clearPreview();
    change = existingUrl ? { kind: "removed" } : { kind: "unchanged" };
    draw();
  }

  function overlayButton(iconName: "image" | "trash", label: string, action: () => void): HTMLElement {
    const onclick = (event: MouseEvent) => {
      event.stopPropagation();
      action();
    };
    return h("button", { type: "button", class: "btn btn-sm btn-overlay", onclick }, icon(iconName, "sm"), label);
  }

  function draw(): void {
    const url = shownUrl();
    zone.dispatchEvent(new Event("picturechange"));
    if (!url) {
      const prompt = h("div", { class: "dz-text" },
        icon("image"),
        h("strong", {}, "Add a cover picture"),
        h("span", { class: "small muted" }, "Click to choose, or drop a file here"),
        h("span", { class: "tiny muted" }, hint));
      mount(zone, prompt);
      return;
    }

    const actions = h("div", { class: "dz-actions" }, overlayButton("image", "Replace", () => void pick()), overlayButton("trash", "Remove", remove));
    mount(zone, h("img", { src: url, alt: "Cover preview" }), actions);
  }

  zone.addEventListener("click", () => void pick());
  zone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void pick();
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("over");
    accept(event.dataTransfer?.files[0]);
  });

  draw();
  return { element: zone, change: () => change, use: accept, shown: shownUrl };
}
