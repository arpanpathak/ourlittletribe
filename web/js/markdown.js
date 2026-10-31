// A small Markdown renderer that builds DOM nodes directly, so text people
// write can never become markup. It covers what the editor's toolbar inserts:
// headings, bold, italic, strikethrough, code, links, pictures uploaded here,
// lists (bulleted, numbered, checklists), quotes, dividers and code blocks.

import { h } from "./ui.js";

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
/** Pictures may only come from this server's own uploads. */
const OWN_PICTURE = /^media\/[0-9a-f-]{36}(_s)?\.jpg$/;

const INLINE_RULES = [
  ["code", /`([^`\n]+)`/],
  ["image", /!\[([^\]\n]*)\]\(([^)\s]+)\)/],
  ["link", /\[([^\]\n]+)\]\(([^)\s]+)\)/],
  ["bold", /\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__/],
  ["strike", /~~(?=\S)([\s\S]+?)~~/],
  ["italic", /\*(?=[^\s*])([^*\n]+?)\*|(?<![\w])_(?=\S)([^_\n]+?)_(?![\w])/],
  ["url", /https?:\/\/[^\s<]*[^\s<.,:;"')\]!?]/],
];

/** Turns one line or paragraph of text into inline nodes. */
function inline(text) {
  const nodes = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const [kind, pattern] of INLINE_RULES) {
      const match = pattern.exec(rest);
      if (match && (best === null || match.index < best.match.index)) best = { kind, match };
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    const { kind, match } = best;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    nodes.push(inlineNode(kind, match));
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

function inlineNode(kind, match) {
  switch (kind) {
    case "code":
      return h("code", {}, match[1]);
    case "image":
      return OWN_PICTURE.test(match[2])
        ? h("img", { src: match[2], alt: match[1], loading: "lazy", decoding: "async" })
        : link(match[2], match[1] || match[2]);
    case "link":
      return link(match[2], inline(match[1]));
    case "bold":
      return h("strong", {}, inline(match[1] ?? match[2]));
    case "strike":
      return h("del", {}, inline(match[1]));
    case "italic":
      return h("em", {}, inline(match[1] ?? match[2]));
    default:
      return link(match[0], match[0]);
  }
}

function link(url, content) {
  if (!SAFE_LINK.test(url)) return h("span", {}, content);
  return h("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, content);
}

/** Inline nodes with single line breaks kept, the way people type in a box. */
function withBreaks(lines) {
  const nodes = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(h("br"));
    nodes.push(...inline(line));
  });
  return nodes;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*$/;
const DIVIDER = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

function list(lines, start) {
  const ordered = /\d/.test(LIST_ITEM.exec(lines[start])[2]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]);
    if (!match || /\d/.test(match[2]) !== ordered) break;
    const task = TASK.exec(match[3]);
    const content = [match[3]];
    index += 1;
    while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !LIST_ITEM.test(lines[index])) {
      content.push(lines[index].trim());
      index += 1;
    }
    if (task) {
      content[0] = task[2];
      const done = task[1] !== " ";
      items.push(h("li", { class: `task${done ? " done" : ""}` },
        h("span", { class: "task-box", "aria-hidden": "true" }), h("span", { class: "sr-only" }, done ? "Done: " : "To do: "), h("span", {}, withBreaks(content))));
    } else {
      items.push(h("li", {}, withBreaks(content)));
    }
  }
  const startNumber = ordered ? parseInt(LIST_ITEM.exec(lines[start])[2], 10) : null;
  const element = h(ordered ? "ol" : "ul", { start: ordered && startNumber !== 1 ? startNumber : null }, items);
  if (items.some((item) => item.classList.contains("task"))) element.classList.add("tasks");
  return { element, next: index };
}

/** Renders Markdown text as a `.prose` element. */
export function renderMarkdown(text) {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const code = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(h("pre", {}, h("code", {}, code.join("\n"))));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(h(["h2", "h3", "h4"][heading[1].length - 1], {}, inline(heading[2])));
      index += 1;
      continue;
    }
    if (DIVIDER.test(line)) {
      blocks.push(h("hr"));
      index += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const quoted = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(h("blockquote", {}, [...renderMarkdown(quoted.join("\n")).childNodes]));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const { element, next } = list(lines, index);
      blocks.push(element);
      index = next;
      continue;
    }
    const paragraph = [];
    while (
      index < lines.length && lines[index].trim() &&
      !FENCE.test(lines[index]) && !HEADING.test(lines[index]) && !DIVIDER.test(lines[index]) &&
      !lines[index].startsWith(">") && !LIST_ITEM.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(h("p", {}, withBreaks(paragraph)));
  }
  return h("div", { class: "prose" }, blocks);
}

/** Plain text from Markdown, for one-line previews on cards. */
export function markdownToText(text) {
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
