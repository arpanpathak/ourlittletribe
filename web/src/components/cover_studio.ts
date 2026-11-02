// The cover studio: the model writes a rich description of a scene for the
// tribe or event, you read and change it, and the model draws it as SVG,
// shape by shape. You watch the drawing grow and can stop it at any time;
// stopping, or closing the dialog, stops the model too. Nothing comes from a
// template. The drawing becomes a PNG and is uploaded like any other cover.

import { drafts } from "../api/client.js";
import type { CoverRequest } from "../api/types.js";
import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { errorMessage } from "../ui/feedback.js";
import { openModal } from "../ui/modal.js";
import { svgAddress, svgToPng } from "../ui/rasterize.js";

/** How often the growing drawing is redrawn, milliseconds. */
const SKETCH_EVERY_MS = 1000;

/** Where the studio is up to. */
type Stage =
  | { kind: "describing" }
  | { kind: "ready" }
  | { kind: "drawing"; startedAt: number }
  | { kind: "stopped" }
  | { kind: "drawn"; svg: string }
  | { kind: "failed"; message: string };

/** Tags in an SVG, such as `<g>`, `</g>` or `<rect … />`. */
const TAG = /<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g;

/**
 * The drawing so far, cut back to its last whole tag with whatever is still
 * open closed, so the browser can show it; null before it has begun.
 */
function sketchOf(partial: string): string | null {
  const start = partial.indexOf("<svg");
  const end = partial.lastIndexOf(">") + 1;
  if (start < 0 || end <= start) return null;

  const whole = partial.slice(start, end);
  const open: string[] = [];

  for (const [, closing, name, selfClosing] of whole.matchAll(TAG)) {
    if (selfClosing) continue;
    if (closing) open.pop();
    else if (name) open.push(name);
  }

  const closers = open.reverse().map((name) => `</${name}>`).join("");
  return whole + closers;
}

/** Whole seconds since `startedAt`. */
function secondsSince(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

/** The studio inside its dialog. */
class CoverStudio {
  /** The studio, for the dialog's body. */
  readonly element: HTMLElement;

  /** The scene to draw, which the person can change. */
  private readonly scene = h("textarea", { class: "studio-scene", rows: 8, maxlength: 2500, placeholder: "Describe the scene: the place, the light, the season, who is there and what they are doing." });
  /** The drawing, or what is happening. */
  private readonly preview = h("div", { class: "cover-preview" });
  /** A line under the preview, such as how long the drawing has taken. */
  private readonly caption = h("p", { class: "tiny muted cover-caption" });
  /** The buttons for the current stage. */
  private readonly buttons = h("div", { class: "cover-studio-actions" });

  private stage: Stage = { kind: "describing" };
  /** The model's SVG so far, uncleaned, while it draws. */
  private partial = "";
  /** Ends the request in flight, which stops the model. */
  private request: AbortController | null = null;
  /** Redraws the growing drawing while the model draws. */
  private ticker: number | null = null;

  constructor(private readonly subject: CoverRequest, private readonly finish: (file: File) => void) {
    const sceneHead = h("div", { class: "row-between" },
      h("label", { class: "field-label" }, "The scene"),
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => void this.describe() }, icon("wand", "sm"), "Write another"));
    const hint = h("p", { class: "tiny muted" }, "The model wrote this from the name, place, date and description. Change anything, then draw it.");

    this.element = h("div", { class: "cover-studio" },
      h("div", { class: "stack" }, sceneHead, this.scene, hint),
      h("div", { class: "stack" }, this.preview, this.caption),
      this.buttons);
    void this.describe();
  }

  /** Stops whatever the model is doing; call when the dialog closes. */
  close(): void {
    this.request?.abort();
    this.request = null;
    this.stopTicker();
  }

  private stopTicker(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
  }

  /** A fresh signal for the next request, ending any still in flight. */
  private freshSignal(): AbortSignal {
    this.close();
    this.request = new AbortController();
    return this.request.signal;
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.draw();
  }

  /* ── Asking the model ───────────────────────────── */

  private async describe(): Promise<void> {
    const signal = this.freshSignal();
    this.setStage({ kind: "describing" });

    try {
      const { scene } = await drafts.coverScene(this.subject, signal);
      this.scene.value = scene;
      this.setStage({ kind: "ready" });
    } catch (error) {
      if (signal.aborted) return;
      this.setStage({ kind: "failed", message: errorMessage(error) });
    }
  }

  private async drawScene(): Promise<void> {
    const scene = this.scene.value.trim();
    if (scene.length < 20) {
      this.scene.focus();
      return;
    }

    const signal = this.freshSignal();
    this.partial = "";
    this.setStage({ kind: "drawing", startedAt: Date.now() });
    this.ticker = window.setInterval(() => this.draw(), SKETCH_EVERY_MS);

    try {
      const svg = await drafts.coverDrawing(scene, signal, (piece) => {
        this.partial += piece;
      });
      this.stopTicker();
      this.setStage({ kind: "drawn", svg });
    } catch (error) {
      this.stopTicker();
      if (signal.aborted) return;
      this.setStage({ kind: "failed", message: errorMessage(error) });
    }
  }

  /** Stops the drawing; the model stops too. */
  private stopDrawing(): void {
    this.close();
    this.setStage({ kind: "stopped" });
  }

  private async use(svg: string): Promise<void> {
    const file = await svgToPng(svg, `${this.subject.subject}-cover`);
    this.finish(file);
  }

  /* ── Drawing the studio for its stage ───────────── */

  /** The drawing so far as a picture, or a note while nothing is drawn yet. */
  private sketch(note: string): HTMLElement {
    const sketch = sketchOf(this.partial);
    if (!sketch) return h("div", { class: "cover-waiting" }, h("span", { class: "spinner" }), note);

    return h("img", { src: svgAddress(sketch), alt: "The drawing so far" });
  }

  private previewFor(stage: Stage): HTMLElement {
    switch (stage.kind) {
      case "describing":
        return h("div", { class: "cover-waiting" }, h("span", { class: "spinner" }), "Writing a scene for this…");
      case "ready":
        return h("div", { class: "cover-waiting" }, icon("image"), "Your drawing appears here, shape by shape.");
      case "drawing":
        return this.sketch("Starting to draw…");
      case "stopped": {
        const sketch = sketchOf(this.partial);
        if (!sketch) return h("div", { class: "cover-waiting" }, icon("image"), "Stopped before anything was drawn.");

        return h("img", { class: "cover-stopped", src: svgAddress(sketch), alt: "The unfinished drawing" });
      }
      case "drawn":
        return h("img", { src: svgAddress(stage.svg), alt: "The drawn cover" });
      case "failed":
        return h("div", { class: "cover-waiting text-danger" }, icon("alert"), stage.message);
    }
  }

  private captionFor(stage: Stage): string {
    switch (stage.kind) {
      case "drawing":
        return `Drawing… ${secondsSince(stage.startedAt)} s. Usually about a minute; you can stop at any time.`;
      case "stopped":
        return "Stopped. The model has stopped too. Change the scene or draw it again.";
      case "describing":
      case "ready":
      case "drawn":
      case "failed":
        return "";
    }
  }

  private buttonsFor(stage: Stage): HTMLElement[] {
    const draw = (label: string, primary: boolean) =>
      h("button", { type: "button", class: primary ? "btn btn-primary" : "btn", onclick: () => void this.drawScene() }, icon("sparkles", "sm"), label);
    const stop = h("button", { type: "button", class: "btn btn-danger", onclick: () => this.stopDrawing() }, icon("x", "sm"), "Stop");

    switch (stage.kind) {
      case "describing":
        return [h("button", { type: "button", class: "btn btn-primary", disabled: true }, h("span", { class: "spinner" }), "Writing the scene…")];
      case "drawing":
        return [stop];
      case "ready":
      case "failed":
        return [draw("Draw it", true)];
      case "stopped":
        return [draw("Draw again", true)];
      case "drawn":
        return [draw("Draw again", false), h("button", { type: "button", class: "btn btn-primary", onclick: () => void this.use(stage.svg) }, icon("check", "sm"), "Use as cover")];
    }
  }

  private draw(): void {
    mount(this.preview, this.previewFor(this.stage));
    this.caption.textContent = this.captionFor(this.stage);
    mount(this.buttons, this.buttonsFor(this.stage));
  }
}

/** Opens the studio; resolves with the cover picture, or undefined if closed without one. Closing it stops the model. */
export function openCoverStudio(subject: CoverRequest): Promise<File | undefined> {
  let studio: CoverStudio | null = null;

  const chosen = openModal<File>({
    title: "Draw a cover with AI",
    wide: true,
    build: (close) => {
      studio = new CoverStudio(subject, (file) => close(file));
      return studio.element;
    },
  });

  return chosen.finally(() => studio?.close());
}
