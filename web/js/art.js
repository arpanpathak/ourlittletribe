// Hand-drawn PNW art as inline SVG: the Cascades skyline, fir forests,
// tribe emblems and Squatch, the tribe's trail buddy.
// Every string here is static; no user text is ever put into these templates.

const FOREST_DARK = "#1d3a2f";
const FOREST_MID = "#2f5a45";
const FUR = "#7a5338";
const FUR_DARK = "#5b3c28";
const FACE = "#d8b08a";
const BEANIE = "#e07a5f";
const PACK = "#3f7d64";

function seededRandom(seed) {
  let state = seed;
  return function next() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function firTree(x, baseY, height, color) {
  const half = height * 0.28;
  const tiers = [0, 0.3, 0.55];
  let shapes = `<rect x="${x - 1.2}" y="${baseY - height * 0.12}" width="2.4" height="${height * 0.14}" fill="${color}"/>`;
  for (const offset of tiers) {
    const top = baseY - height + offset * height;
    const bottom = baseY - height * 0.1 - (0.55 - offset) * height * 0.35;
    const width = half * (0.55 + offset);
    shapes += `<polygon points="${x},${top} ${x - width},${bottom} ${x + width},${bottom}" fill="${color}"/>`;
  }
  return shapes;
}

function treeLine(seed, count, baseY, minHeight, maxHeight, color, width) {
  const random = seededRandom(seed);
  let trees = "";
  for (let tree = 0; tree < count; tree += 1) {
    const x = (tree / count) * width + random() * (width / count);
    const height = minHeight + random() * (maxHeight - minHeight);
    trees += firTree(x, baseY + random() * 6, height, color);
  }
  return trees;
}

const SKIES = {
  dawn: { top: "#f6c7a1", middle: "#f3dcc2", bottom: "#d9e7e3", sun: "#fff1d6", far: "#9fb7c4", near: "#6f8f9c" },
  dusk: { top: "#3b4a7a", middle: "#c86f6a", bottom: "#f2a65a", sun: "#ffd59a", far: "#5d5f86", near: "#41456a" },
  night: { top: "#0b1220", middle: "#16233a", bottom: "#24364f", sun: "#e9eef7", far: "#2b3d55", near: "#1d2c40" },
};

/** The Cascades at the given time of day, with Rainier in the middle. */
export function skyline(variant = "dawn", { stars = false } = {}) {
  const sky = SKIES[variant] || SKIES.dawn;
  const id = `sky-${variant}-${Math.floor(Math.random() * 1e6)}`;
  let starField = "";
  if (stars) {
    const random = seededRandom(7);
    for (let star = 0; star < 60; star += 1) {
      starField += `<circle cx="${random() * 1200}" cy="${random() * 170}" r="${random() * 1.3 + 0.3}" fill="#fff" opacity="${0.4 + random() * 0.6}"/>`;
    }
  }
  return `<svg class="skyline" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky.top}"/><stop offset="0.55" stop-color="${sky.middle}"/><stop offset="1" stop-color="${sky.bottom}"/>
    </linearGradient>
    <linearGradient id="${id}-mist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.35"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="360" fill="url(#${id})"/>
  ${starField}
  <circle cx="930" cy="110" r="38" fill="${sky.sun}" opacity="0.9"/>
  <path d="M0 250 L120 190 L210 225 L320 160 L420 215 L500 185 L560 205 L640 175 L760 230 L860 170 L980 215 L1080 180 L1200 220 L1200 360 L0 360Z" fill="${sky.far}" opacity="0.7"/>
  <path d="M380 260 C470 200 540 120 600 92 C622 82 640 84 660 96 C720 130 790 205 900 262 Z" fill="${sky.near}"/>
  <path d="M560 128 C580 110 596 96 612 92 C626 88 640 90 654 100 C668 110 684 124 700 140 C684 136 672 146 660 140 C646 132 638 146 624 140 C610 134 600 148 588 140 C578 134 570 138 560 128 Z" fill="#f7fbff"/>
  <path d="M0 300 L90 250 L170 280 L260 235 L360 285 L450 255 L560 290 L680 250 L780 290 L900 245 L1010 285 L1110 255 L1200 280 L1200 360 L0 360Z" fill="${FOREST_MID}" opacity="0.85"/>
  <g>${treeLine(11, 70, 318, 30, 58, FOREST_MID, 1200)}</g>
  <rect y="250" width="1200" height="110" fill="url(#${id}-mist)"/>
  <g>${treeLine(23, 46, 362, 48, 92, FOREST_DARK, 1200)}</g>
</svg>`;
}

const POSES = {
  wave: `<path d="M86 70 C98 58 102 44 100 34" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
         <circle cx="100" cy="31" r="7" fill="${FUR_DARK}"/>
         <path d="M34 72 C26 84 24 96 28 106" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>`,
  think: `<path d="M84 74 C92 80 84 92 70 70" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
          <path d="M34 72 C26 84 24 96 28 106" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
          <g class="think-dots"><circle cx="102" cy="22" r="4" fill="#9fb7c4"/><circle cx="111" cy="12" r="5" fill="#9fb7c4"/><circle cx="104" cy="36" r="3" fill="#9fb7c4"/></g>`,
  map: `<path d="M34 74 C38 86 46 92 52 92" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
        <path d="M86 74 C82 86 74 92 68 92" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
        <g transform="translate(40 80)"><polygon points="0,0 14,4 26,0 40,4 40,30 26,26 14,30 0,26" fill="#f6ecd5" stroke="#c9b48a"/>
        <path d="M4 20 C12 10 20 22 30 8 L36 12" stroke="#e07a5f" stroke-width="2" fill="none" stroke-dasharray="3 2"/></g>`,
  cheer: `<path d="M86 70 C98 58 102 44 100 34" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
          <path d="M34 70 C22 58 18 44 20 34" stroke="${FUR}" stroke-width="11" stroke-linecap="round" fill="none"/>
          <circle cx="100" cy="31" r="7" fill="${FUR_DARK}"/><circle cx="20" cy="31" r="7" fill="${FUR_DARK}"/>`,
};

/** Squatch, the tribe's Sasquatch trail buddy, in one of: wave, think, map, cheer. */
export function squatch(pose = "wave", size = 140) {
  const arms = POSES[pose] || POSES.wave;
  return `<svg class="squatch squatch-${pose}" width="${size}" height="${size * 1.1}" viewBox="0 0 120 132" role="img" aria-label="Squatch, a friendly Sasquatch hiker">
  <ellipse cx="60" cy="128" rx="34" ry="4" fill="#000" opacity="0.12"/>
  <rect x="38" y="66" width="44" height="40" rx="12" fill="${PACK}"/>
  <path d="M30 80 C30 56 44 46 60 46 C76 46 90 56 90 80 L90 104 C90 116 80 122 60 122 C40 122 30 116 30 104 Z" fill="${FUR}"/>
  <path d="M44 70 L44 100 M76 70 L76 100" stroke="${PACK}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="60" cy="96" rx="15" ry="17" fill="${FACE}" opacity="0.55"/>
  ${arms}
  <rect x="40" y="114" width="16" height="12" rx="5" fill="${FUR_DARK}"/>
  <rect x="64" y="114" width="16" height="12" rx="5" fill="${FUR_DARK}"/>
  <circle cx="60" cy="40" r="24" fill="${FUR}"/>
  <path d="M40 34 C40 20 50 12 60 12 C70 12 80 20 80 34 Z" fill="${BEANIE}"/>
  <rect x="38" y="30" width="44" height="8" rx="4" fill="#c4614a"/>
  <circle cx="60" cy="10" r="5" fill="#f2d0c4"/>
  <ellipse cx="60" cy="48" rx="16" ry="13" fill="${FACE}"/>
  <circle cx="53" cy="45" r="2.6" fill="#2a1d14"/><circle cx="67" cy="45" r="2.6" fill="#2a1d14"/>
  <circle cx="54" cy="44" r="0.9" fill="#fff"/><circle cx="68" cy="44" r="0.9" fill="#fff"/>
  <ellipse cx="60" cy="50" rx="3.4" ry="2.4" fill="#5b3c28"/>
  <path d="M54 55 C57 58 63 58 66 55" stroke="#5b3c28" stroke-width="1.8" fill="none" stroke-linecap="round"/>
</svg>`;
}

const EMBLEMS = {
  peak: `<path d="M6 40 L22 14 L30 26 L36 18 L46 40 Z" fill="#6f8f9c"/><path d="M22 14 L26 20 L23 22 L20 19 L18 21 Z" fill="#f7fbff"/><circle cx="38" cy="12" r="4" fill="#f2a65a"/>`,
  forest: `<polygon points="14,40 6,40 14,16 22,40" fill="#2f5a45"/><polygon points="30,40 18,40 28,8 38,40" fill="#1d3a2f"/><polygon points="40,40 34,40 40,22 46,40" fill="#3f7d64"/>`,
  wave: `<path d="M4 30 C12 18 20 18 26 28 C30 34 36 34 44 24" stroke="#4a90a4" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M4 40 C12 32 20 32 26 38 C32 44 38 42 44 36" stroke="#8ecae6" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="36" cy="12" r="4" fill="#f2a65a"/>`,
  coffee: `<rect x="10" y="18" width="22" height="20" rx="4" fill="#e9ddc9" stroke="#7a5338" stroke-width="2"/><path d="M32 22 C40 22 40 32 32 32" stroke="#7a5338" stroke-width="3" fill="none"/><path d="M16 14 C14 10 18 8 16 4 M24 14 C22 10 26 8 24 4" stroke="#9fb7c4" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  book: `<path d="M8 12 C14 10 20 10 24 14 L24 40 C20 36 14 36 8 38 Z" fill="#e07a5f"/><path d="M40 12 C34 10 28 10 24 14 L24 40 C28 36 34 36 40 38 Z" fill="#f2a65a"/>`,
  bike: `<circle cx="13" cy="32" r="8" stroke="#2f5a45" stroke-width="3" fill="none"/><circle cx="37" cy="32" r="8" stroke="#2f5a45" stroke-width="3" fill="none"/><path d="M13 32 L21 18 L31 18 L37 32 M21 18 L25 32 L31 18" stroke="#e07a5f" stroke-width="3" fill="none" stroke-linejoin="round"/>`,
};

/** A tribe's small emblem. */
export function emblem(name, size = 48) {
  const drawing = EMBLEMS[name] || EMBLEMS.peak;
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${drawing}</svg>`;
}

/** The names a tribe can pick from. */
export const EMBLEM_NAMES = Object.keys(EMBLEMS);

/** The app's mark: a peak inside a ring. */
export function logoMark(size = 30) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
  <circle cx="16" cy="16" r="15" fill="#1d3a2f"/>
  <path d="M5 24 L13 12 L17 18 L20 14 L27 24 Z" fill="#9fc3b0"/>
  <path d="M13 12 L15 15 L13.5 16 L12 14.6 L11 15.5 Z" fill="#fff"/>
  <circle cx="23" cy="9" r="2.6" fill="#f2a65a"/>
</svg>`;
}

/** A tiny sparkle for things the model suggested. */
export const SPARKLE = `<svg class="sparkle" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.6 6.4 L16 8 L9.6 9.6 L8 16 L6.4 9.6 L0 8 L6.4 6.4 Z" fill="currentColor"/></svg>`;
