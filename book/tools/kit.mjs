// The drawing kit every figure in the book is built from: a panel with a
// title, cards with an accent bar and an icon, pills, lanes and arrows.
// Positions are computed, never typed twice: an arrow is drawn between two
// cards' edges, so it always meets them. Text widths are estimated here and
// checked against the real rendering by tools/audit.mjs.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { iconMarkup } = await import(join(repo, "web", "dist", "icons.js"));

/** The page colours: warm paper, near-black ink, and soft lines. */
export const PAPER = "#faf7f0";
export const CARD = "#ffffff";
export const INK = "#1d2722";
export const MUTED = "#5d6a63";
export const FAINT = "#8b958f";
export const LINE = "#ddd6c6";

/** Accent colours: a strong one for bars and arrows, a soft one for tiles. */
export const HUE = {
  green: { strong: "#2f7d5b", soft: "#e2f0e8", ink: "#174a34" },
  blue: { strong: "#2d6a9f", soft: "#e2edf8", ink: "#173a5c" },
  orange: { strong: "#c8571f", soft: "#fbe7dc", ink: "#6b2a0b" },
  purple: { strong: "#6b4fa0", soft: "#ece6f6", ink: "#36255a" },
  gold: { strong: "#a8741a", soft: "#f6ecd6", ink: "#55390a" },
  red: { strong: "#b8402f", soft: "#f7e0dc", ink: "#5e1b12" },
  slate: { strong: "#4f5d68", soft: "#e7ebee", ink: "#26313a" },
};

const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace";

/** Escapes text for SVG. */
export function esc(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A generous estimate of a line's width in pixels, so boxes are never too small. */
export function textWidth(text, size, { bold = false, mono = false } = {}) {
  const perChar = mono ? 0.62 : bold ? 0.6 : 0.55;
  return String(text).length * size * perChar;
}

/** Text at a point. */
export function text(x, y, content, { size = 13, weight = 400, fill = INK, anchor = "start", mono = false, italic = false } = {}) {
  const family = mono ? MONO : SANS;
  const style = italic ? ' font-style="italic"' : "";
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${style}>${esc(content)}</text>`;
}

/** One of the app's icons, `size` pixels square, with its top-left at (x, y). */
export function icon(name, x, y, size, colour) {
  const inner = iconMarkup(name).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const scale = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${colour}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

/** A box's edges and middle, for drawing arrows to it. */
export function edges(box) {
  return {
    ...box,
    top: { x: box.x + box.w / 2, y: box.y },
    bottom: { x: box.x + box.w / 2, y: box.y + box.h },
    left: { x: box.x, y: box.y + box.h / 2 },
    right: { x: box.x + box.w, y: box.y + box.h / 2 },
  };
}

/**
 * A card: white, rounded, with an accent bar down the left, an icon in a
 * tinted tile, a title, and up to four lines under it. Its width grows to fit
 * the text unless `w` is set; its height fits the lines.
 */
export function card({ x, y, w, title, lines = [], hue = "green", icon: iconName = null, mono = false, titleSize = 14.5 }) {
  const colour = HUE[hue];
  const textLeft = iconName ? 60 : 20;
  const widest = Math.max(textWidth(title, titleSize, { bold: true }), ...lines.map((line) => textWidth(line, 12.5, { mono })));
  const width = w ?? Math.ceil(textLeft + widest + 22);
  const height = Math.max(iconName ? 60 : 44, 22 + 20 + lines.length * 17 + 4);

  const tile = iconName
    ? `<rect x="${x + 16}" y="${y + height / 2 - 16}" width="32" height="32" rx="8" fill="${colour.soft}"/>${icon(iconName, x + 22, y + height / 2 - 10, 20, colour.strong)}`
    : "";
  const blockHeight = 18 + lines.length * 17;
  const titleY = y + height / 2 - blockHeight / 2 + 13;
  const body = lines.map((line, index) => text(x + textLeft, titleY + 19 + index * 17, line, { size: 12.5, fill: MUTED, mono })).join("");

  const svg = `<g>
<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${CARD}" stroke="${LINE}"/>
<rect x="${x}" y="${y + 10}" width="4" height="${height - 20}" rx="2" fill="${colour.strong}"/>
${tile}${text(x + textLeft, titleY, title, { size: titleSize, weight: 650 })}${body}
</g>`;
  return { svg, box: edges({ x, y, w: width, h: height }) };
}

/** A small rounded label. */
export function pill(x, y, content, { hue = "slate", anchor = "start", mono = false, size = 12 } = {}) {
  const colour = HUE[hue];
  const width = Math.ceil(textWidth(content, size, { bold: true, mono }) + 20);
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const svg = `<rect x="${left}" y="${y - 15}" width="${width}" height="22" rx="11" fill="${colour.soft}"/>${text(left + width / 2, y, content, { size, weight: 600, fill: colour.ink, anchor: "middle", mono })}`;
  return { svg, box: edges({ x: left, y: y - 15, w: width, h: 22 }) };
}

/** An arrowhead at `to`, pointing along the segment from `from`. */
function head(from, to, colour) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 8;
  const a = { x: to.x - size * Math.cos(angle - 0.45), y: to.y - size * Math.sin(angle - 0.45) };
  const b = { x: to.x - size * Math.cos(angle + 0.45), y: to.y - size * Math.sin(angle + 0.45) };
  return `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${to.x} ${to.y} L${b.x.toFixed(1)} ${b.y.toFixed(1)} Z" fill="${colour}"/>`;
}

/**
 * An arrow through `points`, straight segments only, with a head at the
 * end. Points are usually card edges, so the line meets the boxes exactly.
 */
export function arrow(points, { hue = "slate", dashed = false, label = null, labelAt = null } = {}) {
  const colour = HUE[hue].strong;
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  const dash = dashed ? ' stroke-dasharray="5 5"' : "";
  const last = points[points.length - 1];
  const before = points[points.length - 2];
  let svg = `<path d="${path}" fill="none" stroke="${colour}" stroke-width="1.8"${dash}/>${head(before, last, colour)}`;

  if (label) {
    const at = labelAt ?? { x: (before.x + last.x) / 2, y: (before.y + last.y) / 2 + 4 };
    svg += pill(at.x, at.y, label, { hue, anchor: "middle", size: 11 }).svg;
  }
  return svg;
}

/** An arrow from the bottom of one box down to the top of another, with an elbow if they are not aligned. */
export function down(from, to, options = {}) {
  const start = from.bottom;
  const end = to.top;
  if (Math.abs(start.x - end.x) < 1) return arrow([start, end], options);

  const middle = (start.y + end.y) / 2;
  return arrow([start, { x: start.x, y: middle }, { x: end.x, y: middle }, end], options);
}

/** An arrow from the right of one box to the left of another, with an elbow if they are not level. */
export function across(from, to, options = {}) {
  const start = from.right;
  const end = to.left;
  if (Math.abs(start.y - end.y) < 1) return arrow([start, end], options);

  const middle = (start.x + end.x) / 2;
  return arrow([start, { x: middle, y: start.y }, { x: middle, y: end.y }, end], options);
}

/** A dashed area around a group of cards, with its name on a tab. */
export function region({ x, y, w, h, label, hue = "slate" }) {
  const colour = HUE[hue];
  const tab = pill(x + 16, y + 4, label, { hue });
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${colour.soft}" fill-opacity=".35" stroke="${colour.strong}" stroke-opacity=".5" stroke-dasharray="6 6"/>${tab.svg}`;
}

/** The whole figure: a paper panel, a title and a one-line subtitle, then `body`. */
export function figure({ width, height, title, subtitle }, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="${PAPER}" stroke="${LINE}"/>
${text(32, 46, title, { size: 21, weight: 700 })}
${text(32, 70, subtitle, { size: 13.5, fill: MUTED })}
${body}
</svg>`;
}

/** Where a figure's content starts, under the title and subtitle. */
export const TOP = 100;
