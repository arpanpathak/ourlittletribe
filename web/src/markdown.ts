// A small Markdown renderer that builds DOM nodes directly, so text people
// write can never become markup. It covers what the editor's toolbar inserts:
// headings, bold, italic, strikethrough, code, links, pictures uploaded here,
// lists (bulleted, numbered, checklists), quotes, dividers and code blocks.

import { h, type Child } from "./dom.js";

/** Links may only go to the web or to an email address. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/** Pictures may only come from this server's own uploads. */
const OWN_PICTURE = /^media\/[0-9a-f-]{36}(_s)?\.jpg$/;

/* ── Inline text ──────────────────────────────────── */

/** The kinds of inline markup, in the order they win when they start at the same place. */
type InlineKind = "code" | "image" | "link" | "bold" | "strike" | "italic" | "url";

const INLINE_RULES: Array<[InlineKind, RegExp]> = [
  ["code", /`([^`\n]+)`/],
  ["image", /!\[([^\]\n]*)\]\(([^)\s]+)\)/],
  ["link", /\[([^\]\n]+)\]\(([^)\s]+)\)/],
  ["bold", /\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__/],
  ["strike", /~~(?=\S)([\s\S]+?)~~/],
  ["italic", /\*(?=[^\s*])([^*\n]+?)\*|(?<![\w])_(?=\S)([^_\n]+?)_(?![\w])/],
  ["url", /https?:\/\/[^\s<]*[^\s<.,:;"')\]!?]/],
];

/** The earliest inline markup in `text`, if any. */
function firstMarkup(text: string): { kind: InlineKind; match: RegExpExecArray } | null {
  let best: { kind: InlineKind; match: RegExpExecArray } | null = null;

  for (const [kind, pattern] of INLINE_RULES) {
    const match = pattern.exec(text);
    if (match && (best === null || match.index < best.match.index)) best = { kind, match };
  }
  return best;
}

function link(url: string, content: Child): HTMLElement {
  if (!SAFE_LINK.test(url)) return h("span", {}, content);
  return h("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, content);
}

function picture(source: string, description: string): HTMLElement {
  if (!OWN_PICTURE.test(source)) return link(source, description || source);
  return h("img", { src: source, alt: description, loading: "lazy", decoding: "async" });
}

function markupNode(kind: InlineKind, match: RegExpExecArray): Node {
  const first = match[1] ?? "";
  const second = match[2] ?? "";

  switch (kind) {
    case "code":
      return h("code", {}, first);
    case "image":
      return picture(second, first);
    case "link":
      return link(second, inline(first));
    case "bold":
      return h("strong", {}, inline(match[1] ?? second));
    case "strike":
      return h("del", {}, inline(first));
    case "italic":
      return h("em", {}, inline(match[1] ?? second));
    case "url":
      return link(match[0], match[0]);
  }
}

/** One line or paragraph of text as inline nodes. */
function inline(text: string): Child[] {
  const nodes: Child[] = [];
  let rest = text;

  while (rest) {
    const found = firstMarkup(rest);
    if (!found) {
      nodes.push(rest);
      break;
    }

    const { kind, match } = found;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    nodes.push(markupNode(kind, match));
    rest = rest.slice(match.index + match[0].length);
  }

  return nodes;
}

/** Lines of a paragraph, with single line breaks kept the way people type them. */
function withBreaks(lines: string[]): Child[] {
  return lines.flatMap((line, index) => (index === 0 ? inline(line) : [h("br"), ...inline(line)]));
}

/* ── Blocks ───────────────────────────────────────── */

const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*$/;
const DIVIDER = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;
const CONTINUATION = /^\s{2,}\S/;

/** What a line starts. */
type BlockKind = "blank" | "fence" | "heading" | "divider" | "quote" | "list" | "paragraph";

function blockKind(line: string): BlockKind {
  if (!line.trim()) return "blank";
  if (FENCE.test(line)) return "fence";
  if (HEADING.test(line)) return "heading";
  if (DIVIDER.test(line)) return "divider";
  if (line.startsWith(">")) return "quote";
  if (LIST_ITEM.test(line)) return "list";
  return "paragraph";
}

/** Reads lines one at a time. */
class Lines {
  private index = 0;

  constructor(private readonly lines: string[]) {}

  /** The next line, without taking it. */
  peek(): string | undefined {
    return this.lines[this.index];
  }

  /** Takes the next line. */
  take(): string {
    const line = this.lines[this.index] ?? "";
    this.index += 1;
    return line;
  }

  /** Takes lines while `keep` says so. */
  takeWhile(keep: (line: string) => boolean): string[] {
    const taken: string[] = [];
    for (let line = this.peek(); line !== undefined && keep(line); line = this.peek()) {
      taken.push(this.take());
    }
    return taken;
  }
}

function codeBlock(lines: Lines): HTMLElement {
  lines.take();
  const code = lines.takeWhile((line) => !FENCE.test(line));
  lines.take();
  return h("pre", {}, h("code", {}, code.join("\n")));
}

function heading(lines: Lines): HTMLElement {
  const match = HEADING.exec(lines.take());
  const level = match?.[1]?.length ?? 1;
  const tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
  return h(tag, {}, inline(match?.[2] ?? ""));
}

function quote(lines: Lines): HTMLElement {
  const quoted = lines.takeWhile((line) => line.startsWith(">")).map((line) => line.replace(/^>\s?/, ""));
  return h("blockquote", {}, [...renderMarkdown(quoted.join("\n")).childNodes]);
}

function paragraph(lines: Lines): HTMLElement {
  return h("p", {}, withBreaks(lines.takeWhile((line) => blockKind(line) === "paragraph")));
}

function listItem(text: string, more: string[]): HTMLElement {
  const task = TASK.exec(text);
  if (!task) return h("li", {}, withBreaks([text, ...more]));

  const done = task[1] !== " ";
  return h("li", { class: done ? "task done" : "task" },
    h("span", { class: "task-box", "aria-hidden": "true" }),
    h("span", { class: "sr-only" }, done ? "Done: " : "To do: "),
    h("span", {}, withBreaks([task[2] ?? "", ...more])));
}

function list(lines: Lines): HTMLElement {
  const first = LIST_ITEM.exec(lines.peek() ?? "");
  const ordered = /\d/.test(first?.[2] ?? "");
  const items: HTMLElement[] = [];

  for (let match = LIST_ITEM.exec(lines.peek() ?? ""); match && /\d/.test(match[2] ?? "") === ordered; match = LIST_ITEM.exec(lines.peek() ?? "")) {
    lines.take();
    const more = lines.takeWhile((line) => CONTINUATION.test(line) && !LIST_ITEM.test(line)).map((line) => line.trim());
    items.push(listItem(match[3] ?? "", more));
  }

  const startNumber = ordered ? parseInt(first?.[2] ?? "1", 10) : 1;
  const element = ordered ? h("ol", { start: startNumber === 1 ? null : startNumber }, items) : h("ul", {}, items);
  if (items.some((item) => item.classList.contains("task"))) element.classList.add("tasks");
  return element;
}

/** Renders Markdown text as a `.prose` element. */
export function renderMarkdown(text: string): HTMLElement {
  const lines = new Lines((text || "").replace(/\r\n?/g, "\n").split("\n"));
  const blocks: HTMLElement[] = [];

  for (let line = lines.peek(); line !== undefined; line = lines.peek()) {
    switch (blockKind(line)) {
      case "blank":
        lines.take();
        break;
      case "fence":
        blocks.push(codeBlock(lines));
        break;
      case "heading":
        blocks.push(heading(lines));
        break;
      case "divider":
        lines.take();
        blocks.push(h("hr"));
        break;
      case "quote":
        blocks.push(quote(lines));
        break;
      case "list":
        blocks.push(list(lines));
        break;
      case "paragraph":
        blocks.push(paragraph(lines));
        break;
    }
  }

  return h("div", { class: "prose" }, blocks);
}

/** Plain text from Markdown, for one-line previews on cards. */
export function markdownToText(text: string): string {
  return (text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,3}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d{1,3}[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*)[*_]/g, "$1$2")
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
