// Illustrations drawn as inline SVG and animated with CSS, so they cost no
// downloads. Colours come from `--art-*` tokens, so every scene has a day
// version and a night version that follows the theme. All markup here is the
// app's own; nothing a person types ever reaches it.

import type { IconName } from "./icons.js";

let nextId = 0;

/** The colours of one person in the scenes. */
interface Outfit {
  /** Skin. */
  skin: string;
  /** Hair. */
  hair: string;
  /** Jacket. */
  top: string;
  /** Jacket in shade, for the arm. */
  topDark: string;
  /** Trousers. */
  bottom: string;
  /** Trousers in shade, for the back leg. */
  bottomDark: string;
  /** Backpack, when they carry one. */
  pack?: string;
  /** Backpack in shade. */
  packDark?: string;
  /** Hat, when they wear one. */
  hat?: string;
  /** Hat band. */
  hatDark?: string;
  /** Long hair tied back, drawn behind the head. */
  ponytail?: boolean;
}

/** The friends who appear in the scenes: the first four everywhere, the rest on covers. */
export type CrewMember = "ada" | "bo" | "cy" | "dee" | "eli" | "fay" | "gus" | "ivy" | "jo" | "kai";

/** How a person stands in a scene. */
export type Pose = "walk" | "wave" | "stand";

/** Where and how to draw a person. */
export interface Placement {
  /** Where their feet are, horizontally. */
  x: number;
  /** Where their feet are, vertically. */
  y: number;
  /** Size; 1 is about 115 units tall. */
  scale?: number;
  /** Walking, waving or standing. */
  pose?: Pose;
  /** Seconds to offset their animation by, so a group does not move in step. */
  delay?: number;
  /** Facing left instead of right. */
  flip?: boolean;
}

/** People who appear in the scenes; each has their own colours. */
const CREW: Record<CrewMember, Outfit> = {
  ada: { skin: "#f1c7a5", hair: "#3b2a20", top: "#2f7d5b", topDark: "#24614a", bottom: "#3b4a5c", bottomDark: "#2c3746", pack: "#e07a3f", packDark: "#b85f2c" },
  bo: { skin: "#8d5a3b", hair: "#1d1512", top: "#e0b13a", topDark: "#bf9327", bottom: "#384656", bottomDark: "#2a3542", pack: "#3f6fb0", packDark: "#30578c", hat: "#c94f3d", hatDark: "#a63e2f" },
  cy: { skin: "#d9a27c", hair: "#6b3b22", top: "#c95c4a", topDark: "#a9483a", bottom: "#4b5b48", bottomDark: "#384536", pack: "#5c6f3a", packDark: "#46552b" },
  dee: { skin: "#f5d3b8", hair: "#d8a64a", top: "#4c79b8", topDark: "#3b6196", bottom: "#5a4a3f", bottomDark: "#45382f", hat: "#2f3b4a", hatDark: "#222b36" },
  eli: { skin: "#6b4430", hair: "#120d0b", top: "#7a4fb0", topDark: "#5f3d8c", bottom: "#2f3a45", bottomDark: "#222b33", pack: "#d6a23a", packDark: "#b0832a", ponytail: true },
  fay: { skin: "#f3d0b4", hair: "#a2421f", top: "#2a8c8c", topDark: "#1f6c6c", bottom: "#46423d", bottomDark: "#35322e", ponytail: true },
  gus: { skin: "#c48a62", hair: "#2a1c14", top: "#d45d2a", topDark: "#ae4a20", bottom: "#3d4b3a", bottomDark: "#2d382b", pack: "#4b5d73", packDark: "#394859", hat: "#e7c24e", hatDark: "#c49f32" },
  ivy: { skin: "#a26a48", hair: "#1a1210", top: "#e05a7a", topDark: "#bd4762", bottom: "#36405a", bottomDark: "#283047", pack: "#2f7d5b", packDark: "#24614a", ponytail: true },
  jo: { skin: "#e8b796", hair: "#5a5a5a", top: "#5b6b2f", topDark: "#475424", bottom: "#4a3b30", bottomDark: "#382c24", hat: "#7a4a2a", hatDark: "#5e381f" },
  kai: { skin: "#7c5236", hair: "#0f0b09", top: "#2f5fa8", topDark: "#244b86", bottom: "#c9b48a", bottomDark: "#a8956f", pack: "#c94f3d", packDark: "#a63e2f" },
};

/** Everyone who can appear on a cover. */
export const EVERYONE = Object.keys(CREW) as CrewMember[];

/**
 * A person facing right with their feet at (0, 0), about 115 units tall.
 * `pose` is `walk`, `wave` or `stand`; `delay` offsets their animation.
 */
export function person(who: CrewMember, { x, y, scale = 1, pose = "walk", delay = 0, flip = false }: Placement): string {
  const c = CREW[who];
  const pack = c.pack && c.packDark
    ? `<rect x="-22" y="-80" width="16" height="34" rx="7" fill="${c.pack}"/><rect x="-21" y="-85" width="13" height="8" rx="4" fill="${c.packDark}"/>`
    : "";
  const strap = c.pack ? `<path d="M-7 -78 L-1 -50" stroke="${c.packDark}" stroke-width="3" stroke-linecap="round"/>` : "";
  const ponytail = c.ponytail ? `<path d="M-11 -101 q-12 4 -10 22 q4 -3 6 -12 q2 -6 4 -10z" fill="${c.hair}"/>` : "";
  const head = c.hat && c.hatDark
    ? `<path d="M-13 -99 a14 13 0 0 1 28 0 z" fill="${c.hat}"/><rect x="-14" y="-102" width="30" height="6" rx="3" fill="${c.hatDark}"/><circle cx="1" cy="-114" r="4" fill="${c.hat}"/>`
    : `<path d="M-10 -101 a12 12 0 0 1 22 -3 q-9 5 -22 3z" fill="${c.hair}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})">
  <ellipse cx="0" cy="1" rx="20" ry="4" class="a-shadow"/>
  <g class="a-person a-${pose}" style="--d:${delay}s">
    <g class="a-leg a-leg-b"><rect x="-6" y="-44" width="9" height="42" rx="4.5" fill="${c.bottomDark}"/><path d="M-6 -5 h10 a5 5 0 0 1 5 5 h-15z" fill="#2a2724"/></g>
    <g class="a-leg a-leg-a"><rect x="-4" y="-44" width="9" height="42" rx="4.5" fill="${c.bottom}"/><path d="M-4 -5 h10 a5 5 0 0 1 5 5 h-15z" fill="#3a3430"/></g>
    <g class="a-upper">
      ${pack}
      <rect x="-12" y="-80" width="23" height="40" rx="10" fill="${c.top}"/>
      ${strap}
      <rect x="-3" y="-87" width="7" height="9" rx="3" fill="${c.skin}"/>
      ${ponytail}<circle cx="-1" cy="-97" r="12.5" fill="${c.hair}"/>
      <circle cx="2" cy="-95" r="11" fill="${c.skin}"/>
      ${head}
      <g class="a-eye"><circle cx="8" cy="-96" r="1.6" fill="#1d1a18"/></g>
      <circle cx="6.5" cy="-91" r="2.4" fill="#e8846b" opacity=".35"/>
      <path d="M8 -90.5 q2.2 1.8 4.4 0" stroke="#1d1a18" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <g class="a-arm"><rect x="-3.5" y="-76" width="8" height="30" rx="4" fill="${c.topDark}"/><circle cx="0.5" cy="-46" r="4.2" fill="${c.skin}"/></g>
    </g>
  </g>
</g>`;
}

/** A pine tree standing at (x, y), `size` tall. */
export function tree(x: number, y: number, size: number, fill: string, sway = false): string {
  const w = size * 0.42;
  const s = size;
  return `<g transform="translate(${x} ${y})"><g class="${sway ? "a-sway" : ""}">
  <rect x="${-s * 0.035}" y="${-s * 0.12}" width="${s * 0.07}" height="${s * 0.13}" style="fill:var(--art-trunk)"/>
  <path d="M0 ${-s} L${w * 0.55} ${-s * 0.64} H${w * 0.3} L${w * 0.8} ${-s * 0.34} H${w * 0.5} L${w} ${-s * 0.1} H${-w} L${-w * 0.5} ${-s * 0.34} H${-w * 0.8} L${-w * 0.3} ${-s * 0.64} H${-w * 0.55} Z" style="fill:${fill}"/>
</g></g>`;
}

function cloud(x: number, y: number, scale: number, delay: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><g class="a-drift" style="--d:${delay}s">
  <ellipse cx="0" cy="0" rx="46" ry="15" style="fill:var(--art-cloud)"/>
  <circle cx="-14" cy="-10" r="17" style="fill:var(--art-cloud)"/>
  <circle cx="12" cy="-14" r="21" style="fill:var(--art-cloud)"/>
</g></g>`;
}

function bird(x: number, y: number, delay: number): string {
  return `<g transform="translate(${x} ${y})"><g class="a-fly" style="--d:${delay}s"><path class="a-flap" style="--d:${delay}s" d="M-9 0 q4.5 -6 9 0 q4.5 -6 9 0" fill="none" stroke-width="2" stroke-linecap="round"/></g></g>`;
}

const STARS: Array<[number, number]> = [[60, 50], [130, 95], [210, 40], [290, 80], [350, 30], [420, 70], [500, 35], [700, 60], [760, 120], [560, 90], [40, 150], [250, 140], [460, 130], [740, 20], [180, 180]];

function sky(id: string): string {
  return `<defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" style="stop-color:var(--art-sky-1)"/><stop offset="1" style="stop-color:var(--art-sky-2)"/>
</linearGradient></defs>
<rect width="800" height="520" fill="url(#${id}-sky)"/>
<g class="a-day">
  <circle cx="610" cy="120" r="64" style="fill:var(--art-sun)" opacity=".18"/>
  <g class="a-spin" style="transform-origin:610px 120px">${Array.from({ length: 12 }, (_, index) => `<rect x="606" y="54" width="8" height="16" rx="4" style="fill:var(--art-sun)" opacity=".55" transform="rotate(${index * 30} 610 120)"/>`).join("")}</g>
  <circle cx="610" cy="120" r="40" style="fill:var(--art-sun)"/>
</g>
<g class="a-night">
  ${STARS.map(([sx, sy], index) => `<circle class="a-twinkle" style="--d:${(index % 5) * 0.7}s" cx="${sx}" cy="${sy}" r="${index % 3 === 0 ? 2 : 1.4}" fill="#fff"/>`).join("")}
  <circle cx="610" cy="118" r="52" fill="#f4efd8" opacity=".08"/>
  <circle cx="610" cy="118" r="32" fill="#f1ead2"/>
  <circle cx="598" cy="110" r="6" fill="#dcd3b4"/><circle cx="620" cy="128" r="4" fill="#dcd3b4"/><circle cx="622" cy="106" r="3" fill="#dcd3b4"/>
</g>`;
}

/** Which friends walk the trail, front to back. */
type Trio = [CrewMember, CrewMember, CrewMember];

/**
 * The big landscape: mountains, forest, a trail and a few friends on it.
 * Used on the sign-in page and as the feed's banner.
 */
export function heroScene(crew: Trio = ["dee", "bo", "ada"]): string {
  nextId += 1;
  const id = `art${nextId}`;
  const farTrees = [30, 70, 105, 150, 190, 610, 650, 690, 730, 770].map((x, index) => tree(x, 352 + (index % 3) * 4, 34 + (index % 4) * 6, "var(--art-tree-far)")).join("");
  return `<svg class="art art-hero" viewBox="0 0 800 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
${sky(id)}
${cloud(150, 120, 1, 0)}${cloud(420, 80, 0.7, -12)}${cloud(720, 200, 0.55, -6)}
<g class="a-day" style="stroke:var(--art-ink-soft)">${bird(250, 150, 0)}${bird(275, 162, -0.3)}${bird(300, 146, -0.6)}</g>
<path d="M0 330 L90 262 L150 292 L240 200 L300 252 L360 218 L470 150 Q520 118 570 150 L650 212 L720 182 L800 240 V520 H0Z" style="fill:var(--art-far)"/>
<path d="M470 150 Q520 118 570 150 L556 160 L540 151 L522 166 L505 152 L489 163 Z" style="fill:var(--art-snow)"/>
<path d="M240 200 L221 215 L231 213 L240 222 L250 211 L259 215 Z" style="fill:var(--art-snow)"/>
<path d="M0 362 C80 322 160 332 230 347 C320 367 380 322 470 327 C560 332 640 362 800 332 V520 H0Z" style="fill:var(--art-mid)"/>
${farTrees}
<path d="M0 432 C120 397 260 402 380 422 C520 447 650 407 800 417 V520 H0Z" style="fill:var(--art-near)"/>
<path d="M-10 512 C150 474 300 474 420 466 C540 458 640 444 810 449 L810 461 C650 459 540 474 420 482 C300 490 160 496 -10 526Z" style="fill:var(--art-trail)"/>
${tree(52, 486, 170, "var(--art-tree)", true)}${tree(122, 470, 120, "var(--art-tree-2)", true)}
${tree(700, 468, 130, "var(--art-tree-2)", true)}${tree(760, 492, 180, "var(--art-tree)", true)}
${person(crew[0], { x: 330, y: 484, scale: 0.78, delay: -0.25 })}
${person(crew[1], { x: 395, y: 478, scale: 0.84, delay: -0.5 })}
${person(crew[2], { x: 462, y: 471, scale: 0.8, delay: 0 })}
<path d="M0 506 C200 496 600 500 800 504 V520 H0Z" style="fill:var(--art-ground)"/>
</svg>`;
}

/* ── Small scenes for empty pages ────────────────────── */

const BLOB = `<ellipse cx="120" cy="88" rx="96" ry="66" style="fill:var(--art-blob)"/>`;

function frame(inner: string): string {
  return `<svg class="art art-spot" viewBox="0 0 240 160" aria-hidden="true" focusable="false">${BLOB}${inner}</svg>`;
}

/** The small scenes, by name. */
type SpotName = "events" | "tribe" | "photos" | "lost" | "search" | "list" | "map" | "tent";

const SPOTS: Record<SpotName, () => string> = {
  events: () => frame(`
<g class="a-float"><rect x="46" y="34" width="96" height="94" rx="12" style="fill:var(--surface);stroke:var(--border-strong)" stroke-width="1.5"/>
<path d="M46 46 a12 12 0 0 1 12 -12 h72 a12 12 0 0 1 12 12 v10 h-96z" fill="#d9622b"/>
<rect x="66" y="26" width="6" height="16" rx="3" style="fill:var(--text-3)"/><rect x="116" y="26" width="6" height="16" rx="3" style="fill:var(--text-3)"/>
${[0, 1, 2].map((row) => [0, 1, 2].map((column) => `<rect x="${60 + column * 25}" y="${66 + row * 19}" width="17" height="13" rx="3.5" style="fill:${row === 1 && column === 1 ? "var(--accent)" : "var(--surface-3)"}"/>`).join("")).join("")}
<path class="a-draw" d="M89.5 91.5 l3.5 3.5 l6 -7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
${person("ada", { x: 182, y: 146, scale: 0.8, pose: "wave" })}`),

  tribe: () => frame(`
<g transform="translate(36 30)"><rect x="0" y="0" width="3" height="110" rx="1.5" style="fill:var(--art-trunk)"/><path class="a-flag" d="M3 4 h34 l-8 10 l8 10 h-34z" style="fill:var(--accent)"/></g>
${person("cy", { x: 78, y: 146, scale: 0.72, pose: "wave", delay: -0.4 })}
${person("bo", { x: 128, y: 148, scale: 0.8, pose: "stand" })}
${person("dee", { x: 180, y: 146, scale: 0.72, pose: "wave", flip: true, delay: -0.9 })}`),

  photos: () => frame(`
<g class="a-float" style="--d:-1s"><g transform="rotate(-12 70 70)"><rect x="40" y="40" width="58" height="64" rx="4" style="fill:var(--surface);stroke:var(--border)"/><rect x="45" y="45" width="48" height="42" rx="2" style="fill:var(--art-sky-1)"/><path d="M45 87 l14 -18 l10 10 l8 -8 l16 16z" style="fill:var(--art-mid)"/></g></g>
<g class="a-float" style="--d:-2.2s"><g transform="rotate(10 178 64)"><rect x="150" y="34" width="56" height="62" rx="4" style="fill:var(--surface);stroke:var(--border)"/><rect x="155" y="39" width="46" height="40" rx="2" style="fill:var(--art-sky-2)"/><circle cx="188" cy="52" r="6" style="fill:var(--art-sun)"/><path d="M155 79 l16 -16 l12 10 l18 -12 v18z" style="fill:var(--art-near)"/></g></g>
<rect x="72" y="66" width="98" height="66" rx="12" fill="#34404c"/><rect x="88" y="56" width="30" height="14" rx="4" fill="#34404c"/>
<circle cx="121" cy="99" r="23" fill="#22303b"/><circle cx="121" cy="99" r="15" fill="#4c6a85"/><circle cx="116" cy="94" r="5" fill="#a9c6dd"/>
<rect x="146" y="73" width="14" height="8" rx="2" fill="#f7c35f"/>
<g class="a-flash"><path d="M153 77 l0 -26 M153 77 l18 -18 M153 77 l26 0" stroke="#f7c35f" stroke-width="3" stroke-linecap="round"/></g>`),

  lost: () => frame(`
${person("bo", { x: 92, y: 146, scale: 0.84, pose: "stand" })}
<text class="a-bob" x="104" y="44" font-size="30" font-weight="800" style="fill:var(--accent)">?</text>
<g transform="translate(170 92)"><circle r="32" style="fill:var(--surface);stroke:var(--border-strong)" stroke-width="2"/><circle r="25" fill="none" style="stroke:var(--surface-3)" stroke-width="2"/>
<g class="a-needle"><path d="M0 -21 L6 0 L0 21 L-6 0z" fill="#d9622b"/><path d="M0 0 L6 0 L0 21 L-6 0z" style="fill:var(--text-3)"/></g><circle r="3" style="fill:var(--text)"/></g>`),

  search: () => frame(`
<path d="M24 140 C70 98 110 104 150 120 C180 132 200 118 220 112 V150 H24Z" style="fill:var(--art-mid)"/>
${tree(60, 130, 50, "var(--art-tree)")}${tree(196, 124, 40, "var(--art-tree-2)")}
<g class="a-scan"><circle cx="120" cy="72" r="28" style="fill:var(--surface);stroke:var(--text-2)" stroke-width="7" fill-opacity=".55"/><rect x="138" y="92" width="11" height="34" rx="5.5" transform="rotate(-45 143 109)" style="fill:var(--text-2)"/></g>`),

  list: () => frame(`
<rect x="62" y="24" width="116" height="122" rx="12" style="fill:var(--surface);stroke:var(--border-strong)" stroke-width="1.5"/>
<rect x="96" y="16" width="48" height="18" rx="6" style="fill:var(--text-3)"/>
${[0, 1, 2].map((row) => `<rect x="78" y="${50 + row * 30}" width="18" height="18" rx="5" style="fill:var(--surface-2);stroke:var(--border-strong)"/>
<rect x="106" y="${55 + row * 30}" width="${56 - row * 12}" height="8" rx="4" style="fill:var(--surface-3)"/>
<path class="a-tick" style="--d:${row * 0.6}s" d="M82 ${59 + row * 30} l4 4 l8 -9" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}`),

  map: () => frame(`
<path d="M40 44 L88 30 L136 44 L196 30 V128 L136 142 L88 128 L40 142Z" style="fill:var(--surface);stroke:var(--border-strong)" stroke-width="1.5"/>
<path d="M88 30 V128 M136 44 V142" style="stroke:var(--border-strong)" stroke-width="1.5"/>
<path d="M88 30 L136 44 V142 L88 128Z" style="fill:var(--surface-2)"/>
<path d="M58 118 C80 90 100 112 118 86 S160 70 168 62" class="a-route" fill="none" stroke="#d9622b" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="7 7"/>
<circle cx="58" cy="118" r="5" style="fill:var(--info)"/>
<g class="a-drop"><path d="M168 64 c-11 -12 -14 -18 -14 -24 a14 14 0 0 1 28 0 c0 6 -3 12 -14 24z" style="fill:var(--accent)"/><circle cx="168" cy="40" r="5" fill="#fff"/></g>`),

  tent: () => frame(`
${[[40, 40], [70, 22], [200, 34], [176, 18], [214, 64]].map(([sx, sy], index) => `<circle class="a-twinkle" style="--d:${index * 0.5}s;fill:var(--art-sun)" cx="${sx}" cy="${sy}" r="2"/>`).join("")}
<path d="M48 136 L102 52 L156 136Z" style="fill:var(--accent)"/><path d="M102 52 L156 136 H130Z" fill="#000" opacity=".14"/>
<path d="M102 82 L84 136 H120Z" style="fill:var(--art-ink-soft)" opacity=".7"/>
<g transform="translate(186 134)"><path d="M-16 2 l32 -6 M-16 -4 l32 6" stroke="#7a5338" stroke-width="5" stroke-linecap="round"/>
<path class="a-flame" d="M0 -6 c-12 -8 -8 -22 0 -32 c2 10 12 12 10 22 c-1 6 -5 10 -10 10z" fill="#f08a3c"/>
<path class="a-flame" style="--d:-.3s" d="M0 -6 c-6 -5 -5 -13 0 -19 c1 6 7 8 6 13 c-1 4 -3 6 -6 6z" fill="#f7c35f"/></g>`),
};

const SPOT_FOR_ICON: Partial<Record<IconName, SpotName>> = {
  calendar: "events",
  users: "tribe",
  image: "photos",
  camera: "photos",
  compass: "lost",
  alert: "lost",
  search: "search",
  list: "list",
  sparkles: "list",
  map: "map",
  pin: "map",
  route: "map",
  store: "map",
  clock: "tent",
};

/** A small scene for an empty page, chosen to suit `iconName`; null if none suits. */
export function spotFor(iconName: IconName): string | null {
  const name = SPOT_FOR_ICON[iconName];
  return name ? SPOTS[name]() : null;
}
