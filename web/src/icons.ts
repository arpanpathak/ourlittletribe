// Line icons on a 24-pixel grid, drawn with the current text colour.

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  pin: '<path d="M12 21.5s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9.5" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  image: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><circle cx="8.5" cy="9" r="1.8"/><path d="m21 15.5-5-5L5 20.5"/>',
  camera: '<path d="M4 7.5h3l1.8-2.5h6.4L17 7.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5z"/><circle cx="12" cy="13.5" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  navigation: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  map: '<path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1-4 4.2-6 8-6s7 2 8 6"/>',
  upload: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 15v4.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.8M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  thermometer: '<path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z"/>',
  rain: '<path d="M17.5 15A4.5 4.5 0 0 0 17 6a6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 6 15"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
  wind: '<path d="M3 8.5h11a2.5 2.5 0 1 0-2.5-2.5M3 12.5h15a3 3 0 1 1-3 3M3 16.5h7"/>',
  sunset: '<path d="M12 9V2.5M8.5 6 12 2.5 15.5 6"/><path d="M4.2 11.2l1.4 1.4M2 17h2M20 17h2M18.4 12.6l1.4-1.4M22 21H2M16 17a4 4 0 0 0-8 0"/>',
  mountain: '<path d="m2.5 20 7-12 4 6.5 2.5-3.5 5.5 9z"/>',
  snow: '<path d="M12 2.5v19M4 7l16 10M4 17 20 7"/>',
  sparkles: '<path d="M10 3.5 11.8 8.2 16.5 10l-4.7 1.8L10 16.5l-1.8-4.7L3.5 10l4.7-1.8z"/><path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  store: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M3.5 9a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0"/><path d="M5 11.5V20h14v-8.5M10 20v-5h4v5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  feed: '<rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/>',
  bold: '<path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7zM7 12h7a3.75 3.75 0 0 1 0 7.5H7z"/>',
  italic: '<path d="M14.5 4.5 9.5 19.5M10 4.5h8M6 19.5h8"/>',
  strike: '<path d="M4 12h16M16.5 7.5c-.6-1.8-2.3-3-4.5-3-2.6 0-4.5 1.4-4.5 3.4 0 1.3.7 2.2 2 2.9M7.5 16.5c.6 1.8 2.4 3 4.7 3 2.6 0 4.4-1.4 4.4-3.5 0-.7-.2-1.3-.6-1.8"/>',
  heading: '<path d="M6 4.5v15M18 4.5v15M6 12h12"/>',
  listOrdered: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4.5h1.5v4M3.5 8.5h3.5M3.5 14.2a1.6 1.6 0 1 1 2.6 1.3L3.5 18.5H7"/>',
  listChecks: '<path d="m3 6 1.6 1.6L8 4.2M3 12.5l1.6 1.6L8 10.7"/><path d="M11.5 6H21M11.5 12.5H21M11.5 19H21"/><rect x="3" y="17" width="4" height="4" rx="1"/>',
  quote: '<path d="M4.5 17.5c2.5-1 3.5-3 3.5-6V7H4v5h4M14 17.5c2.5-1 3.5-3 3.5-6V7h-4v5h4"/>',
  code: '<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  minus: '<path d="M4 12h16"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.8M12 17h.01"/>',
  fileText: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  cloudSun: '<path d="M8.5 6.2a3.6 3.6 0 0 1 6 1.4M6.2 3.6l.7 1.2M11 2.5v1.4M3.5 7.8l1.2.6"/><path d="M8 19.5h9.5a3.5 3.5 0 0 0 .3-7 5.2 5.2 0 0 0-10 1.4A2.9 2.9 0 0 0 8 19.5z"/>',
  fog: '<path d="M5 9.5a5.5 5.5 0 0 1 10.6-2A3.8 3.8 0 0 1 19 11"/><path d="M3.5 14h17M5.5 17.5h13M8 21h8"/>',
  storm: '<path d="M17.5 14A4.5 4.5 0 0 0 17 5a6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 6 14"/><path d="m12.5 12-2.5 4.5h4L11.5 21"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  wand: '<path d="m4 20 11-11M14 4v2M19 9h2M17.5 5.5 19 4M17.5 12.5 19 14M11 5.5 9.5 4"/><path d="m13.5 7.5 3 3"/>',
  logoPeak: '<path d="m3 19 6.5-11 3.5 6 2.5-3.5L21 19z"/><circle cx="17" cy="6" r="1.6"/>',
} as const;

/** The name of an icon. */
export type IconName = keyof typeof PATHS;

/** Icon sizes besides the default 18 pixels. */
export type IconSize = "sm" | "lg";

/** An icon as SVG markup, for places that need a string. */
export function iconMarkup(name: IconName, size?: IconSize): string {
  const sizeClass = size ? ` ${size}` : "";
  return `<svg class="icon${sizeClass}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** An icon as an element. */
export function icon(name: IconName, size?: IconSize): SVGElement {
  const holder = document.createElement("span");
  holder.innerHTML = iconMarkup(name, size);
  return holder.firstElementChild as SVGElement;
}
