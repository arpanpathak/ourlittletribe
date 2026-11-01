// The cover studio: the model writes a rich description of a scene for the
// tribe or event, you read and change it, and the model draws it as SVG,
// shape by shape. Nothing comes from a template. The drawing becomes a PNG
// and is uploaded like any other cover.

import { drafts } from "../api/client.js";
import type { CoverRequest } from "../api/types.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { errorMessage } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { svgAddress, svgToPng } from "../ui/rasterize.js";

/** Where the studio is up to. */
type Stage =
  | { kind: "describing" }
  | { kind: "ready" }
  | { kind: "drawing"; startedAt: number }
  | { kind: "drawn"; svg: string }
  | { kind: "failed"; message: string };

/** The studio inside its dialog. */
class CoverStudio {
  /** The studio, for the dialog's body. */
  readonly element: HTMLElement;

  private readonly scene = h("textarea", { class: "studio-scene", rows: 8, maxlength: 2500, placeholder: "Describe the scene: the place, the light, the season, who is there and what they are doing." });
  private readonly preview = h("div", { class: "cover-preview" });
  private readonly buttons = h("div", { class: "cover-studio-actions" });
  private stage: Stage = { kind: "describing" };
  private ticker: number | null = null;

  constructor(private readonly request: CoverRequest, private readonly finish: (file: File) => void) {
    const sceneHead = h("div", { class: "row-between" },
      h("label", { class: "field-label" }, "The scene"),
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => void this.describe() }, icon("wand", "sm"), "Write another"));
    const hint = h("p", { class: "tiny muted" }, "The model wrote this from the name, place, date and description. Change anything, then draw it.");

    this.element = h("div", { class: "cover-studio" }, h("div", { class: "stack" }, sceneHead, this.scene, hint), this.preview, this.buttons);
    void this.describe();
  }

  /** Stops the clock; call when the dialog closes. */
  stop(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.draw();
  }

  private async describe(): Promise<void> {
    this.setStage({ kind: "describing" });

    try {
      const { scene } = await drafts.coverScene(this.request);
      this.scene.value = scene;
      this.setStage({ kind: "ready" });
    } catch (error) {
      this.setStage({ kind: "failed", message: errorMessage(error) });
    }
  }

  private async drawScene(): Promise<void> {
    const scene = this.scene.value.trim();
    if (scene.length < 20) {
      this.scene.focus();
      return;
    }

    this.setStage({ kind: "drawing", startedAt: Date.now() });
    this.ticker = window.setInterval(() => this.draw(), 1000);

    try {
      const { svg } = await drafts.coverDrawing(scene);
      this.stop();
      this.setStage({ kind: "drawn", svg });
    } catch (error) {
      this.stop();
      this.setStage({ kind: "failed", message: errorMessage(error) });
    }
  }

  private async use(svg: string): Promise<void> {
    const file = await svgToPng(svg, `${this.request.subject}-cover`);
    this.finish(file);
  }

  /* ── Drawing the studio for its stage ───────────── */

  private previewFor(stage: Stage): HTMLElement {
    switch (stage.kind) {
      case "describing":
        return h("div", { class: "cover-waiting" }, h("span", { class: "spinner" }), "Writing a scene for this…");
      case "ready":
        return h("div", { class: "cover-waiting" }, icon("image"), "Your drawing appears here.");
      case "drawing": {
        const seconds = Math.round((Date.now() - stage.startedAt) / 1000);
        return h("div", { class: "cover-waiting" }, h("span", { class: "spinner" }), `Drawing every shape… ${seconds} s. This takes about a minute.`);
      }
      case "drawn":
        return h("img", { src: svgAddress(stage.svg), alt: "The drawn cover" });
      case "failed":
        return h("div", { class: "cover-waiting text-danger" }, icon("alert"), stage.message);
    }
  }

  private buttonsFor(stage: Stage): HTMLElement[] {
    const draw = (label: string, primary: boolean) =>
      h("button", { type: "button", class: primary ? "btn btn-primary" : "btn", onclick: () => void this.drawScene() }, icon("sparkles", "sm"), label);

    switch (stage.kind) {
      case "describing":
      case "drawing":
        return [h("button", { type: "button", class: "btn btn-primary", disabled: true }, h("span", { class: "spinner" }), "Working…")];
      case "ready":
      case "failed":
        return [draw("Draw it", true)];
      case "drawn":
        return [draw("Draw again", false), h("button", { type: "button", class: "btn btn-primary", onclick: () => void this.use(stage.svg) }, icon("check", "sm"), "Use as cover")];
    }
  }

  private draw(): void {
    mount(this.preview, this.previewFor(this.stage));
    mount(this.buttons, this.buttonsFor(this.stage));
  }
}

/** Opens the studio; resolves with the cover picture, or undefined if closed without one. */
export function openCoverStudio(request: CoverRequest): Promise<File | undefined> {
  let studio: CoverStudio | null = null;

  const chosen = openModal<File>({
    title: "Draw a cover with AI",
    wide: true,
    build: (close) => {
      studio = new CoverStudio(request, (file) => close(file));
      return studio.element;
    },
  });

  return chosen.finally(() => studio?.stop());
}
