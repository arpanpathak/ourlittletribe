// Checks every figure as a browser draws it. For each <text>, it measures the
// real rendered box and reports text that overlaps other text, text that
// spills out of the box it sits in, and text outside the picture. It also
// writes a PNG of each figure, for looking at.
// Usage: node book/tools/audit.mjs <folder of svg files> <folder for pngs>
// Needs Playwright's Chromium; set PLAYWRIGHT_CORE to its package folder.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [folder, pngFolder] = process.argv.slice(2);
const core = process.env.PLAYWRIGHT_CORE ?? "/tmp/pw/node_modules/playwright-core/index.mjs";
const shell = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell`;
const { chromium } = await import(core);

/** Runs in the page: every problem with the figure's text. */
function problems() {
  const svg = document.querySelector("svg");
  const view = svg.viewBox.baseVal;
  const texts = [...svg.querySelectorAll("text")].map((element) => ({ element, box: element.getBBox(), words: element.textContent }));
  const rects = [...svg.querySelectorAll("rect")].filter((shape) => !shape.closest("g[transform]") && shape.ownerSVGElement === svg).map((element) => element.getBBox()).filter((box) => box.width > 30 && box.height > 16);
  const found = [];

  const inside = (outer, x, y) => x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;

  for (const rect of [...svg.querySelectorAll("rect")].filter((shape) => !shape.closest("g[transform]") && shape.ownerSVGElement === svg)) {
    const box = rect.getBBox();
    const isPanel = box.width > view.width - 4;
    const margin = isPanel ? -1 : 20;
    if (box.x < view.x + margin || box.y < view.y + margin || box.x + box.width > view.width - margin || box.y + box.height > view.height - margin) {
      found.push(`box within ${margin}px of the edge at x=${Math.round(box.x)}, y=${Math.round(box.y)}`);
    }
  }

  for (const [index, first] of texts.entries()) {
    const { box } = first;
    if (box.x < view.x + 20 || box.y < view.y + 20 || box.x + box.width > view.width - 20 || box.y + box.height > view.height - 20) {
      found.push(`within 20px of the edge: "${first.words}"`);
    }

    for (const second of texts.slice(index + 1)) {
      const other = second.box;
      const overlapX = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
      const overlapY = Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
      if (overlapX > 1 && overlapY > 2) found.push(`overlap: "${first.words}" / "${second.words}"`);
    }

    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const holders = rects.filter((rect) => inside(rect, middle.x, middle.y)).sort((a, b) => a.width * a.height - b.width * b.height);
    const holder = holders[0];
    if (holder && (box.x < holder.x + 4 || box.x + box.width > holder.x + holder.width - 6)) {
      found.push(`spills out of its box: "${first.words}"`);
    }
  }
  return found;
}

const browser = await chromium.launch({ executablePath: shell, args: ["--no-sandbox"] });
const page = await browser.newPage({ deviceScaleFactor: 1.5 });
let total = 0;

for (const file of readdirSync(folder).filter((name) => name.endsWith(".svg")).sort()) {
  const svg = readFileSync(join(folder, file), "utf8");
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff">${svg}</body>`);
  const found = await page.evaluate(problems);
  total += found.length;
  console.log(found.length ? `✗ ${file}\n  ${found.join("\n  ")}` : `✓ ${file}`);

  if (pngFolder) await page.locator("svg").first().screenshot({ path: join(pngFolder, file.replace(/\.svg$/, ".png")) });
}

await browser.close();
console.log(total ? `${total} problems` : "no problems");
process.exit(total ? 1 : 0);
