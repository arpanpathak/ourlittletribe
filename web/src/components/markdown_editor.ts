// A writing box with a formatting toolbar, a live preview, starter outlines,
// pictures by button, paste or drop, and the model to write or rewrite it.
// It writes Markdown, so people who know it can type it, and people who don't
// never have to.

import { drafts, pictures } from "../api/client.js";
import { h, mount } from "../dom.js";
import { icon, type IconName } from "../icons.js";
import { renderMarkdown } from "../markdown.js";
import { errorMessage, toast } from "../ui/feedback.js";
import { dropdown, menuItem, type MenuEntry } from "../ui/menu.js";
import { openModal } from "../ui/modal.js";
import { pictureUrl } from "../ui/pictures.js";
import { choosePictures, pictureProblem } from "./picture_picker.js";
import { voiceButton } from "./voice.js";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";

/** Markdown and what it does, for the help panel. */
const CHEATSHEET: Array<[syntax: string, meaning: string]> = [
  ["## Heading", "Heading"],
  ["**bold**", "Bold"],
  ["*italic*", "Italic"],
  ["~~struck~~", "Strikethrough"],
  ["- item", "Bulleted list"],
  ["1. item", "Numbered list"],
  ["- [ ] task", "Checklist"],
  ["> quote", "Quote"],
  ["[text](https://…)", "Link"],
  ["`code`", "Code"],
  ["---", "Divider"],
];

/** Something the model can be asked to do to the text. */
interface AiAction {
  /** The menu's words. */
  label: string;
  /** The menu's icon. */
  icon: IconName;
  /** What the model is told. */
  instruction: string;
}

const AI_ACTIONS: AiAction[] = [
  { label: "Write it for me", icon: "wand", instruction: "Write a description from the details." },
  { label: "Improve the writing", icon: "sparkles", instruction: "Improve this description: clearer, friendlier, well organised. Keep every fact." },
  { label: "Make it shorter", icon: "minus", instruction: "Make this description about half as long, keeping the important facts." },
  { label: "Add a schedule", icon: "clock", instruction: "Add a short schedule section with times, based on the details." },
  { label: "Add what to bring", icon: "listChecks", instruction: "Add a short checklist of what to bring, suited to the place, season and plan." },
];

/** A starting outline offered in the Outline menu. */
export interface Outline {
  /** The menu's words. */
  label: string;
  /** The Markdown it adds. */
  markdown: string;
}

/** What the editor is set up with. */
export interface MarkdownEditorOptions {
  /** The text to start with. */
  value?: string;
  /** The empty box's hint. */
  placeholder?: string;
  /** Most characters. */
  maxLength?: number;
  /** Starting height, in lines. */
  rows?: number;
  /** Outlines for the Outline menu; none hides it. */
  outlines?: Outline[];
  /** Lines about what is being described, for the model; without it there is no AI menu. */
  details?: () => string[];
}

/** Whether the box shows the text or how it will look. */
type Mode = "write" | "preview";

/** A toolbar button. */
interface Tool {
  /** Its icon. */
  icon: IconName;
  /** What it does, in words. */
  label: string;
  /** A letter that, with Ctrl or ⌘, does the same. */
  key?: string;
  /** What it does. */
  run: () => void;
}

/** A gap between groups of toolbar buttons. */
const GAP = "gap";

/** A line that continues a list when Enter is pressed: indent, marker, number, number's end, text. */
const LIST_LINE = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d{1,3})([.)]) |> )(.*)$/;

function imageFiles(files: FileList | undefined | null): File[] {
  return [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
}

function pictureName(file: File): string {
  return (file.name || "picture").replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "");
}

/** The marker the next line of a list starts with. */
function nextMarker(match: RegExpExecArray): string {
  const [, , marker = "", number, numberEnd] = match;
  if (number) return `${Number(number) + 1}${numberEnd ?? "."} `;
  return marker.replace(/\[[xX]\]/, "[ ]");
}

/** A Markdown writing box. */
export class MarkdownEditor {
  /** The editor, to put in a form. */
  readonly element: HTMLElement;
  /** The text box itself. */
  readonly textarea: HTMLTextAreaElement;

  /** The rendered preview. */
  private readonly preview = h("div", { class: "md-preview", hidden: true });
  /** Characters used, shown when nearly full. */
  private readonly counter = h("span", { class: "tiny muted" });
  /** What is happening, such as an upload. */
  private readonly status = h("span", { class: "md-status tiny" });
  /** The toolbar. */
  private readonly toolbar = h("div", { class: "md-toolbar", role: "toolbar", "aria-label": "Formatting" });
  /** The Markdown help panel. */
  private readonly help = h("div", { class: "md-help", hidden: true });
  private readonly writeTab = h("button", { type: "button", role: "tab" }, "Write");
  private readonly previewTab = h("button", { type: "button", role: "tab" }, "Preview");

  /** Ctrl/⌘ shortcuts, by lower-case letter. */
  private readonly shortcuts = new Map<string, () => void>();
  /** Whether the box shows the text or the preview. */
  private mode: Mode = "write";

  constructor(private readonly options: MarkdownEditorOptions = {}) {
    this.textarea = h("textarea", { class: "md-input", rows: this.rows, maxlength: this.maxLength, placeholder: options.placeholder ?? "", spellcheck: "true" });
    this.textarea.value = options.value ?? "";

    const hint = h("span", { class: "tiny muted md-hint" }, icon("info", "sm"), "Formatting with Markdown is supported. Use the toolbar if you're not sure how.");
    this.element = h("div", { class: "md-editor" }, this.toolbar, this.help, this.textarea, this.preview, h("div", { class: "md-foot" }, hint, this.status, this.counter));

    this.drawToolbar();
    this.drawHelp();
    this.listen();
    this.setMode("write", false);
    requestAnimationFrame(() => this.grow());
  }

  /** The text, trimmed. */
  value(): string {
    return this.textarea.value.trim();
  }

  /** Replaces all the text, keeping it undoable where the browser allows. */
  setValue(text: string): void {
    this.setMode("write", false);
    this.textarea.focus();
    this.textarea.setSelectionRange(0, this.textarea.value.length);
    this.replaceSelection(text, 0, 0);
    this.textarea.setSelectionRange(0, 0);
    this.textarea.scrollTop = 0;
  }

  /** Puts in text the model wrote and shows it formatted; the Write tab shows the Markdown to edit. */
  showWritten(text: string): void {
    this.setValue(text);
    this.grow();
    this.setMode("preview", false);
  }

  focus(): void {
    this.textarea.focus();
  }

  private get rows(): number {
    return this.options.rows ?? 8;
  }

  private get maxLength(): number {
    return this.options.maxLength ?? 8000;
  }

  /* ── Editing the text ───────────────────────────── */

  private changed(): void {
    this.textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Replaces the selection with `text`, keeping undo where the browser allows, and selects part of it. */
  private replaceSelection(text: string, selectFrom = text.length, selectTo = selectFrom): void {
    const box = this.textarea;
    const start = box.selectionStart;
    box.focus();

    const undoable = document.execCommand("insertText", false, text);
    if (!undoable) box.setRangeText(text, start, box.selectionEnd, "end");

    box.setSelectionRange(start + selectFrom, start + selectTo);
    this.changed();
  }

  /** Wraps the selection in `marker`, or unwraps it if it already is. */
  private wrap(marker: string, sample: string): void {
    const { selectionStart: start, selectionEnd: end, value: text } = this.textarea;
    const selected = text.slice(start, end);
    const wrapped = text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker;

    if (selected && wrapped) {
      this.textarea.setSelectionRange(start - marker.length, end + marker.length);
      this.replaceSelection(selected, 0, selected.length);
      return;
    }

    const inner = selected || sample;
    this.replaceSelection(`${marker}${inner}${marker}`, marker.length, marker.length + inner.length);
  }

  /** Expands the selection to whole lines and returns them. */
  private selectLines(): string[] {
    const { selectionStart, selectionEnd, value: text } = this.textarea;
    const start = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const searchFrom = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd;
    const lineEnd = text.indexOf("\n", searchFrom);
    const end = lineEnd === -1 ? text.length : lineEnd;

    this.textarea.setSelectionRange(start, end);
    return text.slice(start, end).split("\n");
  }

  /** Puts `prefix(index)` at the start of each selected line, or takes it off if every line has it. */
  private prefixLines(prefix: (index: number) => string, pattern: RegExp): void {
    const lines = this.selectLines();
    const allHave = lines.every((line) => pattern.test(line));
    const result = lines.map((line, index) => (allHave ? "" : prefix(index)) + line.replace(pattern, "")).join("\n");
    this.replaceSelection(result, 0, result.length);
  }

  /** Inserts a block on its own lines, with a blank line before it. */
  private insertBlock(block: string): void {
    const text = this.textarea.value;
    const before = text.slice(0, this.textarea.selectionStart);
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const tail = text.slice(this.textarea.selectionEnd).startsWith("\n") ? "" : "\n";

    this.replaceSelection(`${lead}${block}${tail}`, lead.length + block.length);
  }

  private addLink(): void {
    const { selectionStart: start, selectionEnd: end, value: text } = this.textarea;
    const selected = text.slice(start, end);

    if (/^https?:\/\/\S+$/.test(selected)) {
      this.replaceSelection(`[link text](${selected})`, 1, 10);
      return;
    }

    const label = selected || "link text";
    const markup = `[${label}](https://)`;
    this.replaceSelection(markup, label.length + 3, markup.length - 1);
  }

  /** Continues a list on Enter; returns whether it did. */
  private continueList(): boolean {
    const { selectionStart, value: text } = this.textarea;
    const lineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
    const match = LIST_LINE.exec(text.slice(lineStart, selectionStart));
    if (!match) return false;

    const [, indent = "", , , , rest = ""] = match;
    if (!rest.trim()) {
      this.textarea.setSelectionRange(lineStart, selectionStart);
      this.replaceSelection("");
      return true;
    }

    this.replaceSelection(`\n${indent}${nextMarker(match)}`);
    return true;
  }

  private insertOutline(markdown: string): void {
    this.setMode("write");

    if (this.textarea.value.trim()) {
      this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
      this.insertBlock(markdown);
      return;
    }

    this.textarea.setSelectionRange(0, 0);
    this.replaceSelection(markdown);
  }

  /* ── Pictures ───────────────────────────────────── */

  private async uploadPicture(file: File): Promise<void> {
    const problem = pictureProblem(file);
    if (problem) {
      toast(problem, "error");
      return;
    }

    const name = pictureName(file);
    this.status.textContent = `Uploading ${name}…`;
    try {
      const picture = await pictures.addInline(file);
      this.insertBlock(`![${name}](${pictureUrl(picture.id)})`);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      this.status.textContent = "";
    }
  }

  private async uploadPictures(files: File[]): Promise<void> {
    for (const file of files) await this.uploadPicture(file);
  }

  /* ── The model ──────────────────────────────────── */

  private async runAssist(instruction: string): Promise<void> {
    this.status.textContent = "The model is writing…";
    this.element.classList.add("md-working");

    try {
      const details = this.options.details?.() ?? [];
      const written = await drafts.description({ details, current: this.textarea.value, instruction });
      this.showWritten(written.text);
      toast("Written. Click Write to edit it.", "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      this.status.textContent = "";
      this.element.classList.remove("md-working");
    }
  }

  /** Asks for an instruction, typed or spoken, then has the model write it. */
  private async askCustom(): Promise<void> {
    const box = h("textarea", { rows: 3, maxlength: 500, placeholder: "e.g. Mention carpooling from Ballard, and that kids are welcome" });
    const voiceRow = h("div", { class: "row" }, voiceButton(box), h("span", { class: "small muted" }, "It sees the details and the current text."));

    const instruction = await openModal<string>({
      title: "Tell the model what to write",
      build: () => h("div", { class: "stack" }, box, voiceRow),
      actions: (close) => [
        h("button", { type: "button", class: "btn", onclick: () => close() }, "Cancel"),
        h("button", { type: "button", class: "btn btn-primary", onclick: () => close(box.value.trim()) }, icon("sparkles", "sm"), "Write"),
      ],
    });

    if (instruction) void this.runAssist(instruction);
  }

  private assistMenu(): MenuEntry[] {
    const actions = AI_ACTIONS.map((action) => menuItem(action.icon, action.label, () => void this.runAssist(action.instruction)));
    return [...actions, "-", menuItem("mic", "Tell it what to write…", () => void this.askCustom())];
  }

  /* ── Toolbar and modes ──────────────────────────── */

  private tools(): Array<Tool | typeof GAP> {
    return [
      { icon: "heading", label: "Heading", run: () => this.prefixLines(() => "## ", /^#{1,3}\s+/) },
      { icon: "bold", label: "Bold", key: "B", run: () => this.wrap("**", "bold text") },
      { icon: "italic", label: "Italic", key: "I", run: () => this.wrap("*", "italic text") },
      { icon: "strike", label: "Strikethrough", run: () => this.wrap("~~", "struck text") },
      GAP,
      { icon: "list", label: "Bulleted list", run: () => this.prefixLines(() => "- ", /^\s*[-*+]\s+(\[[ xX]\]\s+)?/) },
      { icon: "listOrdered", label: "Numbered list", run: () => this.prefixLines((index) => `${index + 1}. `, /^\s*\d{1,3}[.)]\s+/) },
      { icon: "listChecks", label: "Checklist", run: () => this.prefixLines(() => "- [ ] ", /^\s*[-*+]\s+\[[ xX]\]\s+/) },
      { icon: "quote", label: "Quote", run: () => this.prefixLines(() => "> ", /^>\s?/) },
      GAP,
      { icon: "link", label: "Link", key: "K", run: () => this.addLink() },
      { icon: "image", label: "Picture", run: () => void choosePictures(true).then((files) => this.uploadPictures(files)) },
      { icon: "code", label: "Code", run: () => this.wrap("`", "code") },
      { icon: "minus", label: "Divider", run: () => this.insertBlock("---") },
    ];
  }

  private toolButton(tool: Tool): HTMLElement {
    if (tool.key) this.shortcuts.set(tool.key.toLowerCase(), tool.run);

    const title = tool.key ? `${tool.label} (${MOD}${tool.key})` : tool.label;
    const onclick = () => {
      if (this.mode !== "write") this.setMode("write");
      tool.run();
    };
    return h("button", { type: "button", class: "md-tool", title, "aria-label": title, onmousedown: (event: MouseEvent) => event.preventDefault(), onclick }, icon(tool.icon, "sm"));
  }

  private textButton(iconName: IconName, label: string, title: string, extraClass = ""): HTMLElement {
    return h("button", { type: "button", class: `md-tool md-tool-text ${extraClass}`.trim(), title }, icon(iconName, "sm"), h("span", {}, label));
  }

  private drawToolbar(): void {
    const buttons = this.tools().map((tool) => (tool === GAP ? h("span", { class: "md-sep" }) : this.toolButton(tool)));

    const assist = this.options.details ? dropdown(this.textButton("sparkles", "Write with AI", "Write with the model", "md-ai"), () => this.assistMenu()) : null;
    const outlines = this.options.outlines ?? [];
    const outlineMenu = () => outlines.map((outline) => menuItem("fileText", outline.label, () => this.insertOutline(outline.markdown)));
    const outline = outlines.length ? dropdown(this.textButton("fileText", "Outline", "Start from an outline"), outlineMenu) : null;

    const helpButton = h("button", { type: "button", class: "md-tool", title: "Formatting help", "aria-label": "Formatting help", "aria-expanded": "false" }, icon("help", "sm"));
    helpButton.addEventListener("click", () => {
      this.help.hidden = !this.help.hidden;
      helpButton.setAttribute("aria-expanded", String(!this.help.hidden));
    });

    this.writeTab.addEventListener("click", () => this.setMode("write"));
    this.previewTab.addEventListener("click", () => this.setMode("preview"));

    mount(this.toolbar,
      h("div", { class: "md-tabs", role: "tablist" }, this.writeTab, this.previewTab),
      h("div", { class: "md-tools" }, buttons),
      h("div", { class: "md-tools md-tools-end" }, assist, outline, helpButton));
  }

  private drawHelp(): void {
    const grid = CHEATSHEET.map(([syntax, meaning]) => [h("code", {}, syntax), h("span", {}, meaning)]);
    const keys = `Paste or drop pictures straight into the box. ${MOD}B bold, ${MOD}I italic, ${MOD}K link. Lists continue when you press Enter.`;
    mount(this.help, h("div", { class: "md-help-grid" }, grid), h("p", { class: "tiny muted" }, keys));
  }

  private setMode(next: Mode, focus = true): void {
    this.mode = next;
    this.writeTab.setAttribute("aria-selected", String(next === "write"));
    this.previewTab.setAttribute("aria-selected", String(next === "preview"));
    this.textarea.hidden = next !== "write";
    this.preview.hidden = next !== "preview";
    this.toolbar.classList.toggle("dim", next !== "write");

    switch (next) {
      case "preview": {
        const rendered = renderMarkdown(this.textarea.value);
        mount(this.preview, rendered.childNodes.length ? rendered : h("p", { class: "muted" }, "Nothing to preview yet."));
        this.preview.style.minHeight = `${this.textarea.offsetHeight || 160}px`;
        break;
      }
      case "write":
        if (focus) this.textarea.focus();
        break;
    }
  }

  /* ── Events ─────────────────────────────────────── */

  private grow(): void {
    const box = this.textarea;
    box.style.height = "auto";
    box.style.height = `${Math.min(Math.max(box.scrollHeight + 2, this.rows * 24), 640)}px`;

    const length = box.value.length;
    this.counter.textContent = length > this.maxLength * 0.8 ? `${length.toLocaleString()} / ${this.maxLength.toLocaleString()}` : "";
  }

  private onKey(event: KeyboardEvent): void {
    const shortcut = this.shortcuts.get(event.key.toLowerCase());
    if ((event.ctrlKey || event.metaKey) && !event.altKey && shortcut) {
      event.preventDefault();
      shortcut();
      return;
    }

    const plainEnter = event.key === "Enter" && !event.shiftKey && this.textarea.selectionStart === this.textarea.selectionEnd;
    if (plainEnter && this.continueList()) event.preventDefault();
  }

  private onFilesIn(event: ClipboardEvent | DragEvent, files: File[]): void {
    if (!files.length) return;
    event.preventDefault();
    void this.uploadPictures(files);
  }

  private listen(): void {
    const box = this.textarea;

    box.addEventListener("input", () => this.grow());
    box.addEventListener("keydown", (event) => this.onKey(event));
    box.addEventListener("paste", (event) => this.onFilesIn(event, imageFiles(event.clipboardData?.files)));

    box.addEventListener("dragover", (event) => {
      const carriesFiles = [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file");
      if (!carriesFiles) return;
      event.preventDefault();
      box.classList.add("over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (event) => {
      box.classList.remove("over");
      this.onFilesIn(event, imageFiles(event.dataTransfer?.files));
    });
  }
}
