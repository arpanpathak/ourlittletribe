// A writing box with a formatting toolbar, a live preview, starter outlines,
// and pictures by button, paste or drop. It writes Markdown, so people who know
// it can type it, and people who don't never have to.

import { api } from "../api.js";
import { h, mount, icon, toast, dropdown, menuItem, pictureUrl } from "../ui.js";
import { renderMarkdown } from "../markdown.js";
import { choosePictures, pictureProblem } from "./picture_picker.js";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";

const CHEATSHEET = [
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

/**
 * Builds the editor. `templates` is a list of [label, markdown] outlines
 * offered while the box is empty or from the Outline menu.
 * Returns `{ element, textarea, value(), focus() }`.
 */
export function markdownEditor({ value = "", placeholder = "", maxLength = 8000, rows = 8, templates = [] } = {}) {
  const textarea = h("textarea", { class: "md-input", rows, maxlength: maxLength, placeholder, spellcheck: "true" });
  textarea.value = value;
  const preview = h("div", { class: "md-preview", hidden: true });
  const counter = h("span", { class: "tiny muted" });
  const status = h("span", { class: "md-status tiny" });
  let mode = "write";

  function changed() {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** Replaces the selection with `text` (keeping undo where the browser allows) and selects part of it. */
  function replaceSelection(text, selectFrom = text.length, selectTo = selectFrom) {
    const start = textarea.selectionStart;
    textarea.focus();
    const kept = document.execCommand?.("insertText", false, text);
    if (!kept) textarea.setRangeText(text, start, textarea.selectionEnd, "end");
    textarea.setSelectionRange(start + selectFrom, start + selectTo);
    changed();
  }

  /** Wraps the selection in `marker`, or unwraps it if it already is. */
  function wrap(marker, sample) {
    const { selectionStart: start, selectionEnd: end, value: text } = textarea;
    const selected = text.slice(start, end);
    const before = text.slice(start - marker.length, start);
    const after = text.slice(end, end + marker.length);
    if (selected && before === marker && after === marker) {
      textarea.setSelectionRange(start - marker.length, end + marker.length);
      replaceSelection(selected, 0, selected.length);
      return;
    }
    const inner = selected || sample;
    replaceSelection(`${marker}${inner}${marker}`, marker.length, marker.length + inner.length);
  }

  /** Expands the selection to whole lines and returns them. */
  function selectLines() {
    const text = textarea.value;
    const start = text.lastIndexOf("\n", textarea.selectionStart - 1) + 1;
    let end = text.indexOf("\n", textarea.selectionEnd - (textarea.selectionEnd > textarea.selectionStart ? 1 : 0));
    if (end === -1) end = text.length;
    textarea.setSelectionRange(start, end);
    return text.slice(start, end).split("\n");
  }

  /** Puts `prefix(index)` at the start of each selected line, or takes it off if every line has it. */
  function prefixLines(prefix, pattern) {
    const lines = selectLines();
    const allHave = lines.every((line) => pattern.test(line));
    const result = lines.map((line, index) => (allHave ? line.replace(pattern, "") : `${prefix(index)}${line.replace(pattern, "")}`)).join("\n");
    replaceSelection(result, 0, result.length);
  }

  /** Inserts a block on its own lines, with a blank line around it. */
  function insertBlock(block, selectFrom = block.length, selectTo = selectFrom) {
    const text = textarea.value;
    const start = textarea.selectionStart;
    const lead = start === 0 || text.slice(0, start).endsWith("\n\n") ? "" : text.slice(0, start).endsWith("\n") ? "\n" : "\n\n";
    const tail = text.slice(textarea.selectionEnd).startsWith("\n") ? "" : "\n";
    replaceSelection(`${lead}${block}${tail}`, lead.length + selectFrom, lead.length + selectTo);
  }

  function addLink() {
    const { selectionStart: start, selectionEnd: end, value: text } = textarea;
    const selected = text.slice(start, end);
    if (/^https?:\/\/\S+$/.test(selected)) {
      replaceSelection(`[link text](${selected})`, 1, 10);
      return;
    }
    const label = selected || "link text";
    const markup = `[${label}](https://)`;
    replaceSelection(markup, label.length + 3, markup.length - 1);
  }

  async function uploadPictures(files) {
    for (const file of files) {
      const problem = pictureProblem(file);
      if (problem) {
        toast(problem, "error");
        continue;
      }
      const name = (file.name || "picture").replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "");
      status.textContent = `Uploading ${name}…`;
      try {
        const picture = await api.addPicture(file);
        insertBlock(`![${name}](${pictureUrl(picture.id)})`);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        status.textContent = "";
      }
    }
  }

  const TOOLS = [
    ["heading", "Heading", null, () => prefixLines(() => "## ", /^#{1,3}\s+/)],
    ["bold", "Bold", "B", () => wrap("**", "bold text")],
    ["italic", "Italic", "I", () => wrap("*", "italic text")],
    ["strike", "Strikethrough", null, () => wrap("~~", "struck text")],
    "|",
    ["list", "Bulleted list", null, () => prefixLines(() => "- ", /^\s*[-*+]\s+(\[[ xX]\]\s+)?/)],
    ["listOrdered", "Numbered list", null, () => prefixLines((index) => `${index + 1}. `, /^\s*\d{1,3}[.)]\s+/)],
    ["listChecks", "Checklist", null, () => prefixLines(() => "- [ ] ", /^\s*[-*+]\s+\[[ xX]\]\s+/)],
    ["quote", "Quote", null, () => prefixLines(() => "> ", /^>\s?/)],
    "|",
    ["link", "Link", "K", addLink],
    ["image", "Picture", null, async () => uploadPictures(await choosePictures(true))],
    ["code", "Code", null, () => wrap("`", "code")],
    ["minus", "Divider", null, () => insertBlock("---")],
  ];

  const shortcuts = new Map();
  const toolbar = h("div", { class: "md-toolbar", role: "toolbar", "aria-label": "Formatting" });
  const toolButtons = TOOLS.map((tool) => {
    if (tool === "|") return h("span", { class: "md-sep" });
    const [iconName, label, key, action] = tool;
    if (key) shortcuts.set(key.toLowerCase(), action);
    const title = key ? `${label} (${MOD}${key})` : label;
    return h("button", {
      type: "button", class: "md-tool", title, "aria-label": title,
      onmousedown: (event) => event.preventDefault(),
      onclick: () => {
        if (mode !== "write") setMode("write");
        action();
      },
    }, icon(iconName, "sm"));
  });

  const outline = templates.length
    ? dropdown(h("button", { type: "button", class: "md-tool md-tool-text", title: "Start from an outline" }, icon("fileText", "sm"), h("span", {}, "Outline")),
        () => templates.map(([label, markdown]) => menuItem("fileText", label, () => {
          setMode("write");
          if (textarea.value.trim()) {
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            insertBlock(markdown);
          } else {
            textarea.setSelectionRange(0, 0);
            replaceSelection(markdown);
          }
        })))
    : null;

  const help = h("div", { class: "md-help", hidden: true },
    h("div", { class: "md-help-grid" }, CHEATSHEET.map(([syntax, meaning]) => [h("code", {}, syntax), h("span", {}, meaning)])),
    h("p", { class: "tiny muted" }, `Paste or drop pictures straight into the box. ${MOD}B bold, ${MOD}I italic, ${MOD}K link. Lists continue when you press Enter.`));
  const helpButton = h("button", {
    type: "button", class: "md-tool", title: "Formatting help", "aria-label": "Formatting help", "aria-expanded": "false",
    onclick: () => {
      help.hidden = !help.hidden;
      helpButton.setAttribute("aria-expanded", String(!help.hidden));
    },
  }, icon("help", "sm"));

  const writeTab = h("button", { type: "button", role: "tab", onclick: () => setMode("write") }, "Write");
  const previewTab = h("button", { type: "button", role: "tab", onclick: () => setMode("preview") }, "Preview");

  function setMode(next, focus = true) {
    mode = next;
    writeTab.setAttribute("aria-selected", String(mode === "write"));
    previewTab.setAttribute("aria-selected", String(mode === "preview"));
    textarea.hidden = mode !== "write";
    preview.hidden = mode !== "preview";
    toolbar.classList.toggle("dim", mode !== "write");
    if (mode === "preview") {
      const rendered = renderMarkdown(textarea.value);
      mount(preview, rendered.childNodes.length ? rendered : h("p", { class: "muted" }, "Nothing to preview yet."));
      preview.style.minHeight = `${textarea.offsetHeight || 160}px`;
    } else if (focus) {
      textarea.focus();
    }
  }

  function grow() {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight + 2, rows * 24), 640)}px`;
    const length = textarea.value.length;
    counter.textContent = length > maxLength * 0.8 ? `${length.toLocaleString()} / ${maxLength.toLocaleString()}` : "";
  }

  textarea.addEventListener("input", grow);
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && shortcuts.has(event.key.toLowerCase())) {
      event.preventDefault();
      shortcuts.get(event.key.toLowerCase())();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && textarea.selectionStart === textarea.selectionEnd) {
      const text = textarea.value;
      const lineStart = text.lastIndexOf("\n", textarea.selectionStart - 1) + 1;
      const line = text.slice(lineStart, textarea.selectionStart);
      const match = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d{1,3})([.)]) |> )(.*)$/.exec(line);
      if (!match) return;
      event.preventDefault();
      if (!match[5].trim()) {
        textarea.setSelectionRange(lineStart, textarea.selectionStart);
        replaceSelection("");
        return;
      }
      let marker = match[2];
      if (match[3]) marker = `${Number(match[3]) + 1}${match[4]} `;
      if (marker.includes("[")) marker = marker.replace(/\[[xX]\]/, "[ ]");
      replaceSelection(`\n${match[1]}${marker}`);
    }
  });
  textarea.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      uploadPictures(files);
    }
  });
  textarea.addEventListener("dragover", (event) => {
    if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
      event.preventDefault();
      textarea.classList.add("over");
    }
  });
  textarea.addEventListener("dragleave", () => textarea.classList.remove("over"));
  textarea.addEventListener("drop", (event) => {
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    textarea.classList.remove("over");
    if (files.length) {
      event.preventDefault();
      uploadPictures(files);
    }
  });

  mount(toolbar,
    h("div", { class: "md-tabs", role: "tablist" }, writeTab, previewTab),
    h("div", { class: "md-tools" }, toolButtons),
    h("div", { class: "md-tools md-tools-end" }, outline, helpButton));

  const element = h("div", { class: "md-editor" },
    toolbar,
    help,
    textarea,
    preview,
    h("div", { class: "md-foot" },
      h("span", { class: "tiny muted md-hint" }, icon("info", "sm"), "Formatting with Markdown is supported. Use the toolbar if you're not sure how."),
      status,
      counter));

  setMode("write", false);
  requestAnimationFrame(grow);
  return {
    element,
    textarea,
    value: () => textarea.value.trim(),
    focus: () => textarea.focus(),
  };
}
