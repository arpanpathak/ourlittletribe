// Writes the book's cover and chapter openers. Each opener is one of the
// app's own cover scenes (web/src/cover_art.ts), chosen to picture the
// chapter's idea, with the chapter's number and title on a banner and a
// short caption, as in the other books in this series.
// Usage: node book/tools/art.mjs   (after building the web app)

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const out = join(here, "..", "src", "art");
const { coverSvg } = await import(join(repo, "web", "dist", "cover_art.js"));

const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
const WIDTH = 800;
const HEIGHT = 450;

/** One chapter's opener: its scene, number, title and caption. */
const CHAPTERS = [
  { file: "ch01.svg", number: 1, title: "High-level design", caption: "one binary, one file, one model", scene: { landscape: "mountains", light: "golden_hour", weather: "clear", season: "summer", activity: "hiking", crew: 3 } },
  { file: "ch02.svg", number: 2, title: "The data", caption: "everything on one blanket", scene: { landscape: "meadow", light: "day", weather: "clouds", season: "spring", activity: "picnic", crew: 4 } },
  { file: "ch03.svg", number: 3, title: "Places and search", caption: "the map's name is not the one you type", scene: { landscape: "mountains", light: "dawn", weather: "mist", season: "autumn", activity: "hiking", crew: 2 } },
  { file: "ch04.svg", number: 4, title: "The model", caption: "one fire, one question at a time", scene: { landscape: "forest", light: "night", weather: "clear", season: "summer", activity: "camping", crew: 3 } },
  { file: "ch05.svg", number: 5, title: "Conditions", caption: "the weather is at the trail", scene: { landscape: "mountains", light: "day", weather: "snow", season: "winter", activity: "skiing", crew: 2 } },
  { file: "ch06.svg", number: 6, title: "Stores on the way", caption: "a stop worth the detour", scene: { landscape: "city", light: "golden_hour", weather: "clear", season: "autumn", activity: "cycling", crew: 2 } },
  { file: "ch07.svg", number: 7, title: "Pictures", caption: "drawn in the browser", scene: { landscape: "lake", light: "dawn", weather: "clear", season: "autumn", activity: "paddling", crew: 3 } },
  { file: "ch08.svg", number: 8, title: "The web app", caption: "many hands, one page", scene: { landscape: "hills", light: "day", weather: "clouds", season: "spring", activity: "gathering", crew: 4 } },
  { file: "ch09.svg", number: 9, title: "Security and privacy", caption: "the key stays with you", scene: { landscape: "forest", light: "dusk", weather: "mist", season: "autumn", activity: "camping", crew: 2 } },
  { file: "ch10.svg", number: 10, title: "Going live", caption: "out in the open", scene: { landscape: "coast", light: "golden_hour", weather: "clouds", season: "summer", activity: "running", crew: 1 } },
  { file: "ch11.svg", number: 11, title: "Roadmap", caption: "the trail ahead", scene: { landscape: "desert", light: "dawn", weather: "clear", season: "spring", activity: "hiking", crew: 3 } },
];

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A scene, scaled into the opener's frame. */
function scene(design) {
  return coverSvg(design).replace(/<svg [^>]*>/, `<svg x="0" y="0" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 800 450">`);
}

/** The chapter's number and title on a banner along the bottom. */
function banner(number, title) {
  const top = HEIGHT - 64;
  return `<rect x="20" y="${top}" width="${WIDTH - 40}" height="44" rx="10" fill="#14231c" fill-opacity=".88"/>
<rect x="20" y="${top}" width="58" height="44" rx="10" fill="#c8571f"/>
<text x="49" y="${top + 30}" font-family="${SANS}" font-size="22" font-weight="800" fill="#ffffff" text-anchor="middle">${number}</text>
<text x="96" y="${top + 29}" font-family="${SANS}" font-size="19" font-weight="750" letter-spacing="1.2" fill="#ffffff">${escapeXml(title.toUpperCase())}</text>`;
}

/** A short caption on a pill at the top left. */
function caption(words) {
  const width = Math.ceil(words.length * 8.4 + 32);
  return `<rect x="20" y="20" width="${width}" height="32" rx="16" fill="#ffffff" fill-opacity=".92"/>
<text x="${20 + width / 2}" y="41" font-family="${SANS}" font-size="15" font-weight="700" fill="#14231c" text-anchor="middle">${escapeXml(words)}</text>`;
}

function opener(chapter) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">
<clipPath id="frame"><rect width="${WIDTH}" height="${HEIGHT}" rx="16"/></clipPath>
<g clip-path="url(#frame)">${scene(chapter.scene)}</g>
${caption(chapter.caption)}
${banner(chapter.number, chapter.title)}
</svg>`;
}

function cover() {
  const design = { landscape: "mountains", light: "golden_hour", weather: "clear", season: "autumn", activity: "hiking", crew: 3 };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">
<clipPath id="frame"><rect width="${WIDTH}" height="${HEIGHT}" rx="18"/></clipPath>
<g clip-path="url(#frame)">${scene(design)}</g>
<rect x="28" y="28" width="560" height="132" rx="16" fill="#fffaf2" fill-opacity=".9"/>
<text x="52" y="86" font-family="${SANS}" font-size="46" font-weight="800" letter-spacing="-1.2" fill="#14231c">OurLittleTribe</text>
<text x="54" y="118" font-family="${SANS}" font-size="18" font-weight="600" fill="#3a4a42">The system design of a small app for getting outside</text>
<text x="54" y="144" font-family="${SANS}" font-size="14" font-weight="600" fill="#6b7a72">Rust · SQLite · TypeScript · a local model on a Jetson Thor</text>
</svg>`;
}

mkdirSync(out, { recursive: true });
for (const old of readdirSync(out)) rmSync(join(out, old));
writeFileSync(join(out, "cover.svg"), cover());
for (const chapter of CHAPTERS) writeFileSync(join(out, chapter.file), opener(chapter));
console.log(`wrote the cover and ${CHAPTERS.length} chapter openers to ${out}`);
