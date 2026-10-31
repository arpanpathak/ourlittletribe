// Writes the book's cover and chapter pictures from the app's own
// illustrations (web/js/art.js), as standalone animated SVG files.
// Usage: node book/tools/art.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const out = join(here, "..", "src", "art");

const { heroScene, spotFor } = await import(join(repo, "web", "js", "art.js"));

/** The illustration rules from the app's stylesheet, with day colours set on the SVG itself. */
function illustrationStyle() {
  const css = readFileSync(join(repo, "web", "app.css"), "utf8");
  const start = css.indexOf("/* ── Illustrations");
  const end = css.indexOf("/* ── Markdown editor");
  const rules = css.slice(start, end)
    .replace(/:root\[data-theme="dark"\][^{]*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="dark"\] \.art[^{]*\{[^}]*\}/g, "")
    .replace(/:root \{/g, "svg {");

  const surfaces = "svg { --surface: #ffffff; --surface-2: #f3f3f0; --surface-3: #ebebe7; --border: #e4e4df; "
    + "--border-strong: #d2d2cc; --text: #191c1a; --text-2: #4a514d; --text-3: #737a76; --accent: #1f6f4e; --info: #2563a8; }";
  return `${surfaces}\n${rules}\n@keyframes spin { to { transform: rotate(360deg); } }`;
}

/** Puts the stylesheet inside an SVG so it renders and animates on its own. */
function standalone(svg, extra = "") {
  const style = `<style>${illustrationStyle()}</style>`;
  return svg
    .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/(<svg[^>]*>)/, `$1${style}${extra}`);
}

function cover() {
  const title = `
<rect x="20" y="30" width="640" height="158" rx="18" fill="#eef6f9" opacity=".82"/>
<g font-family="Inter, 'Helvetica Neue', Arial, sans-serif" fill="#10362a">
  <text x="40" y="92" font-size="54" font-weight="800" letter-spacing="-1.5">OurLittleTribe</text>
  <text x="42" y="132" font-size="21" font-weight="500" opacity=".85">The system design of a small app for getting your people outside</text>
  <text x="42" y="166" font-size="16" font-weight="600" opacity=".7">Rust · SQLite · a local model on a Jetson Thor</text>
</g>`;
  const scene = heroScene({ crew: ["dee", "bo", "ada"] }).replace('preserveAspectRatio="xMidYMax slice"', 'width="800" height="520"');
  return standalone(scene.replace("</svg>", `${title}</svg>`));
}

writeFileSync(join(out, "cover.svg"), cover());

const plates = {
  "ch01.svg": "users",
  "ch02.svg": "list",
  "ch03.svg": "map",
  "ch04.svg": "search",
  "ch05.svg": "clock",
  "ch06.svg": "route",
  "ch07.svg": "image",
  "ch08.svg": "calendar",
  "ch09.svg": "alert",
  "ch10.svg": "compass",
};
for (const [file, iconName] of Object.entries(plates)) {
  const spot = spotFor(iconName).replace('class="art art-spot"', 'class="art art-spot" width="480" height="320"');
  writeFileSync(join(out, file), standalone(spot));
}

console.log("wrote cover and", Object.keys(plates).length, "plates to", out);
