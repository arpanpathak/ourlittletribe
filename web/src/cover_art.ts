// Cover pictures drawn from a scene the model chose: the land, the light, the
// weather, the season, what people are doing and how many. The drawing is a
// standalone SVG with its colours written in, so it can become a PNG and be
// uploaded like any other cover.

import type { Activity, CoverDesign, Landscape, Light, Season, Weather } from "./api/types.js";
import { person, tree, type CrewMember, type Pose } from "./art.js";

/** The drawing's size in its own units; the PNG is twice this. */
const WIDTH = 800;
const HEIGHT = 450;

/** Where people's feet are. */
const FEET_Y = 418;

/**
 * How far the land, ground and people are lifted, in drawing units. Covers
 * are shown at 16:9 on cards but cropped to a 4:1 band across the middle at
 * the top of a page; lifting keeps the people inside that band.
 */
const LIFT = 100;

/** The bottom of anything drawn in the lifted group, so the ground still reaches the bottom edge. */
const LIFTED_BOTTOM = HEIGHT + LIFT;

/**
 * The app's people move with CSS animations, which never reach an image, so
 * a cover holds each pose mid-step: legs apart, arms swinging, a hand up.
 */
const STILL_POSES = `
.a-shadow { fill: #000; opacity: .16; }
.a-leg, .a-arm { transform-box: fill-box; transform-origin: 50% 0; }
.a-walk .a-leg-a { transform: rotate(-17deg); }
.a-walk .a-leg-b { transform: rotate(17deg); }
.a-walk .a-arm { transform: rotate(22deg); }
.a-wave .a-arm { transform: rotate(-150deg); }`;

/** The colours of the sky at one time of day. */
interface SkyColours {
  /** The top of the sky. */
  top: string;
  /** The sky at the horizon. */
  bottom: string;
  /** The sun or moon. */
  sun: string;
  /** Where the sun or moon is, or null when it has set. */
  sunAt: { x: number; y: number } | null;
  /** A colour matrix that tints the land for this light, or null for none. */
  tint: string | null;
}

/** The colours of the land in one season. */
interface LandColours {
  /** The farthest ridge. */
  far: string;
  /** The middle hills. */
  mid: string;
  /** The nearest hills. */
  near: string;
  /** The ground people stand on. */
  ground: string;
  /** A trail or path. */
  trail: string;
  /** The darker pine. */
  tree: string;
  /** The lighter pine. */
  tree2: string;
  /** Distant pines. */
  treeFar: string;
  /** Tree trunks. */
  trunk: string;
  /** Small flowers or leaves on the ground, or null for none. */
  speck: string | null;
}

const SKIES: Record<Light, SkyColours> = {
  dawn: { top: "#f3b8b0", bottom: "#fde4c8", sun: "#ffd27a", sunAt: { x: 170, y: 130 }, tint: "1.04 0 0 0 0  0 .96 0 0 0  0 0 .98 0 0  0 0 0 1 0" },
  day: { top: "#7fb8e6", bottom: "#d6ecf7", sun: "#ffd65c", sunAt: { x: 660, y: 70 }, tint: null },
  golden_hour: { top: "#f2a65a", bottom: "#ffe1a8", sun: "#ffb347", sunAt: { x: 640, y: 135 }, tint: "1.1 0 0 0 0  0 .96 0 0 0  0 0 .8 0 0  0 0 0 1 0" },
  dusk: { top: "#5b4b8a", bottom: "#e58f8f", sun: "#ffb38a", sunAt: null, tint: ".82 0 0 0 0  0 .72 0 0 0  0 0 .92 0 0  0 0 0 1 0" },
  night: { top: "#0e1630", bottom: "#2a3a66", sun: "#f1ead2", sunAt: { x: 650, y: 70 }, tint: ".42 0 0 0 0  0 .48 0 0 0  0 0 .68 0 0  0 0 0 1 0" },
};

const LANDS: Record<Season, LandColours> = {
  spring: { far: "#8ea7c2", mid: "#8cc074", near: "#6aa85a", ground: "#5b9a4c", trail: "#d8c39a", tree: "#2f7a4a", tree2: "#4f9a5e", treeFar: "#5e8f74", trunk: "#6b4a33", speck: "#f4a6c4" },
  summer: { far: "#7f97b3", mid: "#6fa45a", near: "#4f8c45", ground: "#447d3c", trail: "#d4bc8c", tree: "#24603f", tree2: "#3c7f4f", treeFar: "#4b7a62", trunk: "#5e412c", speck: "#ffe27a" },
  autumn: { far: "#9a8fa8", mid: "#b6a05a", near: "#9b8443", ground: "#8a743a", trail: "#e0c48e", tree: "#b9541f", tree2: "#e09a2f", treeFar: "#a77a4a", trunk: "#5b3c26", speck: "#e0662a" },
  winter: { far: "#a9b8c9", mid: "#e4ebf0", near: "#d5dfe6", ground: "#eef3f6", trail: "#c9d3dc", tree: "#2c5545", tree2: "#3f6a58", treeFar: "#6d8a80", trunk: "#4e3b2e", speck: null },
};

/** The order friends join a scene. */
const CREW: CrewMember[] = ["ada", "bo", "dee", "cy"];

/** One person to draw: who, where and how. */
interface Figure {
  /** Who. */
  who: CrewMember;
  /** Where their feet are, horizontally. */
  x: number;
  /** How they stand. */
  pose: Pose;
}

function colour(design: CoverDesign): LandColours {
  const land = design.weather === "snow" || design.activity === "skiing" ? LANDS.winter : LANDS[design.season];
  switch (design.landscape) {
    case "desert":
      return { ...land, mid: "#e2b47a", near: "#d49a5e", ground: "#c98c52", trail: "#efd2a2", tree: "#5d7a4a", tree2: "#7d9a5a", speck: null };
    case "coast":
      return { ...land, ground: "#e6d2a2", trail: "#f1e2bd" };
    default:
      return land;
  }
}

/* ── Sky ──────────────────────────────────────────── */

function skyLayer(sky: SkyColours, light: Light, weather: Weather): string {
  const gradient = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky.top}"/><stop offset="1" stop-color="${sky.bottom}"/></linearGradient></defs>`;
  const base = `${gradient}<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>`;

  const overcast = weather === "rain" || weather === "snow";
  if (!sky.sunAt || overcast) return base;

  const { x, y } = sky.sunAt;
  const glow = `<circle cx="${x}" cy="${y}" r="70" fill="${sky.sun}" opacity=".18"/>`;
  const body = `<circle cx="${x}" cy="${y}" r="${light === "night" ? 30 : 40}" fill="${sky.sun}"/>`;
  return base + glow + body + (light === "night" ? stars() : "");
}

function stars(): string {
  const points: Array<[number, number]> = [[60, 40], [140, 90], [220, 30], [300, 70], [380, 25], [460, 60], [520, 30], [720, 50], [770, 110], [90, 140], [250, 120], [420, 110], [560, 95]];
  return points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index % 3 === 0 ? 2 : 1.3}" fill="#fff" opacity=".9"/>`).join("");
}

function cloud(x: number, y: number, scale: number, fill: string): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}"><ellipse rx="50" ry="16"/><circle cx="-16" cy="-10" r="18"/><circle cx="14" cy="-15" r="23"/></g>`;
}

function cloudLayer(weather: Weather, light: Light): string {
  const fill = light === "night" ? "#4a5a80" : weather === "rain" ? "#9aa6b2" : "#ffffff";
  switch (weather) {
    case "clear":
      return "";
    case "clouds":
    case "mist":
      return cloud(150, 110, 1, fill) + cloud(430, 70, 0.75, fill);
    case "rain":
    case "snow":
      return cloud(120, 80, 1.3, fill) + cloud(360, 60, 1.1, fill) + cloud(610, 90, 1.25, fill);
  }
}

/* ── Land ─────────────────────────────────────────── */

function pineRow(xs: number[], y: number, size: number, fill: string): string {
  return xs.map((x, index) => tree(x, y + (index % 3) * 4, size + (index % 4) * 6, fill)).join("");
}

function landLayer(landscape: Landscape, land: LandColours): string {
  switch (landscape) {
    case "mountains":
      return `<g transform="translate(0 40)"><path d="M0 300 L110 210 L170 250 L280 140 L340 200 L400 170 L500 100 Q540 76 580 100 L660 170 L730 140 L800 200 V450 H0Z" fill="${land.far}"/>
<path d="M500 100 Q540 76 580 100 L566 110 L548 101 L530 116 L514 102Z M280 140 L262 156 L272 154 L281 162 L290 152 L298 156Z" fill="#f4f7fb"/></g>
<path d="M0 330 C120 300 220 312 330 322 C440 332 560 300 800 318 V450 H0Z" fill="${land.mid}"/>
${pineRow([30, 70, 110, 640, 690, 740, 780], 338, 40, land.treeFar)}`;
    case "hills":
      return `<path d="M0 290 C120 230 240 250 340 280 C450 312 560 220 800 260 V450 H0Z" fill="${land.far}" opacity=".7"/>
<path d="M0 330 C140 280 280 300 400 322 C520 344 640 290 800 310 V450 H0Z" fill="${land.mid}"/>`;
    case "forest":
      return `<path d="M0 320 C200 300 600 300 800 320 V450 H0Z" fill="${land.mid}"/>
${pineRow([20, 60, 100, 140, 180, 220, 580, 620, 660, 700, 740, 780], 330, 90, land.treeFar)}
${pineRow([40, 120, 200, 600, 680, 760], 350, 120, land.tree2)}`;
    case "lake":
      return `<path d="M0 290 C140 240 260 260 360 280 C470 300 580 230 800 270 V450 H0Z" fill="${land.far}"/>
<path d="M0 318 C200 300 600 300 800 318 V350 H0Z" fill="${land.mid}"/>
<rect y="340" width="${WIDTH}" height="40" fill="#5b8fbf"/><path d="M80 352 h90 M300 362 h120 M560 350 h80" stroke="#fff" stroke-width="2" opacity=".5"/>`;
    case "coast":
      return `<rect y="300" width="${WIDTH}" height="80" fill="#3f7fb0"/>
<path d="M0 300 H800" stroke="#fff" stroke-width="2" opacity=".5"/><path d="M60 330 h100 M280 318 h80 M520 340 h140" stroke="#fff" stroke-width="2" opacity=".45"/>
<path d="M600 300 C640 250 720 240 800 260 V310 H600Z" fill="${land.far}"/>`;
    case "desert":
      return `<path d="M60 320 V250 H90 V230 H200 V250 H230 V320Z M560 320 V270 H600 V240 H700 V320Z" fill="#c2774a"/>
<path d="M0 330 C160 300 300 320 420 312 C560 302 680 330 800 316 V450 H0Z" fill="${land.mid}"/>`;
    case "city":
      return `<g fill="${land.far}">${[[40, 190, 60], [110, 150, 50], [170, 210, 70], [250, 120, 40], [300, 170, 60], [520, 140, 50], [580, 200, 70], [660, 160, 46], [716, 220, 60]].map(([x, top, w]) => `<rect x="${x}" y="${top}" width="${w}" height="${330 - (top ?? 0)}"/>`).join("")}</g>
<path d="M0 320 C200 304 600 304 800 320 V450 H0Z" fill="${land.mid}"/>`;
    case "meadow":
      return `<path d="M0 300 C200 280 600 280 800 300 V450 H0Z" fill="${land.mid}"/>
${pineRow([40, 90, 720, 770], 304, 50, land.treeFar)}`;
  }
}

function groundLayer(land: LandColours, design: CoverDesign): string {
  const water = design.activity === "paddling";
  const ground = water
    ? `<rect y="372" width="${WIDTH}" height="${LIFTED_BOTTOM - 372}" fill="#4f86b8"/><path d="M60 400 h120 M330 430 h160 M600 410 h120" stroke="#fff" stroke-width="2.5" opacity=".45"/>`
    : `<path d="M0 380 C160 360 320 366 480 372 C620 378 720 364 800 368 V${LIFTED_BOTTOM} H0Z" fill="${land.near}"/><path d="M0 410 C200 396 600 400 800 406 V${LIFTED_BOTTOM} H0Z" fill="${land.ground}"/>`;
  const trail = !water && (design.activity === "hiking" || design.activity === "running")
    ? `<path d="M-10 446 C150 418 320 418 440 414 C560 410 660 400 810 402 L810 412 C660 412 560 424 440 428 C320 434 150 440 -10 456Z" fill="${land.trail}"/>`
    : "";

  const specks = land.speck && !water ? [60, 140, 230, 520, 610, 700, 760].map((x, index) => `<circle cx="${x}" cy="${430 + (index % 3) * 6}" r="3" fill="${land.speck}"/>`).join("") : "";
  const sideTrees = water ? "" : tree(50, 440, 150, land.tree) + tree(750, 444, 170, land.tree) + tree(705, 430, 110, land.tree2);
  return ground + trail + specks + sideTrees;
}

/* ── People and what they are doing ───────────────── */

function figures(activity: Activity, crew: number): Figure[] {
  const who = CREW.slice(0, Math.min(Math.max(crew, 1), 4));
  const spacing = activity === "picnic" || activity === "camping" ? 80 : 64;
  const start = 400 - ((who.length - 1) * spacing) / 2;

  return who.map((member, index) => {
    const x = start + index * spacing;
    switch (activity) {
      case "hiking":
      case "running":
        return { who: member, x, pose: "walk" };
      case "gathering":
      case "picnic":
        return { who: member, x, pose: index % 2 === 0 ? "wave" : "stand" };
      case "cycling":
      case "camping":
      case "paddling":
      case "skiing":
        return { who: member, x, pose: "stand" };
    }
  });
}

function bike(x: number): string {
  const wheel = (cx: number) => `<circle cx="${cx}" cy="${FEET_Y - 16}" r="16" fill="none" stroke="#2b2f36" stroke-width="3.5"/>`;
  const frame = `<path d="M${x + 4} ${FEET_Y - 16} L${x + 20} ${FEET_Y - 40} L${x + 44} ${FEET_Y - 40} L${x + 54} ${FEET_Y - 16} M${x + 20} ${FEET_Y - 40} L${x + 30} ${FEET_Y - 16} L${x + 44} ${FEET_Y - 40} M${x + 42} ${FEET_Y - 48} h10" stroke="#d9622b" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  return wheel(x + 4) + wheel(x + 54) + frame;
}

function props(activity: Activity, people: Figure[]): { behind: string; front: string } {
  const first = people[0]?.x ?? 400;
  const last = people[people.length - 1]?.x ?? 400;

  switch (activity) {
    case "picnic":
      return { behind: `<path d="M${first - 40} ${FEET_Y + 8} L${last + 30} ${FEET_Y + 8} L${last + 10} ${FEET_Y - 10} L${first - 20} ${FEET_Y - 10}Z" fill="#d9483b"/><path d="M${first - 30} ${FEET_Y} H${last + 22}" stroke="#fff" stroke-width="3" stroke-dasharray="10 10"/><rect x="${last + 40}" y="${FEET_Y - 22}" width="30" height="22" rx="4" fill="#a8743a"/><path d="M${last + 44} ${FEET_Y - 22} q11 -16 22 0" stroke="#7a5228" stroke-width="3" fill="none"/>`, front: "" };
    case "camping":
      return { behind: `<path d="M${first - 150} ${FEET_Y} L${first - 95} ${FEET_Y - 90} L${first - 40} ${FEET_Y}Z" fill="#e07a3f"/><path d="M${first - 95} ${FEET_Y - 90} L${first - 40} ${FEET_Y} H${first - 66}Z" fill="#000" opacity=".15"/>`, front: `<g transform="translate(${last + 60} ${FEET_Y})"><path d="M-16 0 l32 -6 M-16 -6 l32 6" stroke="#7a5338" stroke-width="5" stroke-linecap="round"/><path d="M0 -6 c-12 -8 -8 -22 0 -32 c2 10 12 12 10 22 c-1 6 -5 10 -10 10z" fill="#f08a3c"/><path d="M0 -6 c-6 -5 -5 -13 0 -19 c1 6 7 8 6 13 c-1 4 -3 6 -6 6z" fill="#f7c35f"/></g>` };
    case "paddling":
      return { behind: "", front: `<path d="M${first - 60} ${FEET_Y - 30} Q${(first + last) / 2} ${FEET_Y + 6} ${last + 60} ${FEET_Y - 30} L${last + 40} ${FEET_Y - 14} Q${(first + last) / 2} ${FEET_Y + 2} ${first - 40} ${FEET_Y - 14}Z" fill="#b5532a"/>` };
    case "cycling":
      return { behind: people.map((figure) => bike(figure.x + 6)).join(""), front: "" };
    case "skiing":
      return { behind: "", front: people.map((figure) => `<path d="M${figure.x - 26} ${FEET_Y + 2} L${figure.x + 34} ${FEET_Y - 2}" stroke="#2d6a9f" stroke-width="4" stroke-linecap="round"/><path d="M${figure.x + 14} ${FEET_Y - 60} L${figure.x + 26} ${FEET_Y}" stroke="#555" stroke-width="2.5"/>`).join("") };
    case "running":
      return { behind: people.map((figure) => `<path d="M${figure.x - 40} ${FEET_Y - 60} h-24 M${figure.x - 36} ${FEET_Y - 40} h-30" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`).join(""), front: "" };
    case "hiking":
    case "gathering":
      return { behind: "", front: "" };
  }
}

function peopleLayer(design: CoverDesign): string {
  const people = figures(design.activity, design.crew);
  const { behind, front } = props(design.activity, people);
  const scale = design.activity === "paddling" ? 0.6 : 0.82;
  const drawn = people.map((figure, index) => person(figure.who, { x: figure.x, y: FEET_Y - (design.activity === "paddling" ? 14 : 0), scale, pose: figure.pose, delay: -index * 0.3 })).join("");

  return behind + drawn + front;
}

/* ── Weather in front ─────────────────────────────── */

function weatherLayer(weather: Weather): string {
  switch (weather) {
    case "clear":
    case "clouds":
      return "";
    case "mist":
      return `<g fill="#fff" opacity=".35"><rect y="${300 - LIFT}" width="${WIDTH}" height="26" rx="13"/><rect x="-40" y="${342 - LIFT}" width="${WIDTH * 0.7}" height="18" rx="9"/></g>`;
    case "rain":
      return `<g stroke="#c9d6e2" stroke-width="2" opacity=".6">${Array.from({ length: 40 }, (_, index) => `<path d="M${(index * 41) % WIDTH} ${(index * 67) % 380} l-8 18"/>`).join("")}</g>`;
    case "snow":
      return `<g fill="#fff" opacity=".9">${Array.from({ length: 50 }, (_, index) => `<circle cx="${(index * 53) % WIDTH}" cy="${(index * 71) % 420}" r="${index % 3 === 0 ? 3 : 2}"/>`).join("")}</g>`;
  }
}

/* ── The whole picture ────────────────────────────── */

/** The cover as standalone SVG markup, with every colour written in. */
export function coverSvg(design: CoverDesign): string {
  const sky = SKIES[design.light];
  const land = colour(design);

  const tint = sky.tint ? `<filter id="tint"><feColorMatrix type="matrix" values="${sky.tint}"/></filter>` : "";
  const tinted = sky.tint ? ' filter="url(#tint)"' : "";
  const styles = `<style>${STILL_POSES}</style>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 2}" height="${HEIGHT * 2}" style="--art-trunk:${land.trunk}">
${styles}<defs>${tint}</defs>
${skyLayer(sky, design.light, design.weather)}
${cloudLayer(design.weather, design.light)}
<g${tinted} transform="translate(0 -${LIFT})">${landLayer(design.landscape, land)}${groundLayer(land, design)}${peopleLayer(design)}</g>
${weatherLayer(design.weather)}
</svg>`;
}

/** Draws the cover onto a canvas and returns it as a PNG file, ready to upload. */
export async function coverFile(design: CoverDesign, name = "cover"): Promise<File> {
  const url = URL.createObjectURL(new Blob([coverSvg(design)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't draw the cover");
    return new File([blob], `${name}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
