// People's pictures and covers: avatars, banners, and map thumbnails for
// events without a cover.

import type { Event, Tribe } from "../api/types.js";
import { h } from "../dom.js";

/** Someone to show an avatar for. */
export interface Face {
  /** Their name, for initials and the tooltip. */
  name: string;
  /** Their profile picture's id, when they have one. */
  avatar: string | null;
}

/** Which stored copy of a picture to show. */
export type PictureSize = "large" | "small";

/** The address of an uploaded picture. */
export function pictureUrl(id: string, size: PictureSize = "large"): string {
  return size === "small" ? `media/${id}_s.jpg` : `media/${id}.jpg`;
}

/** Initials for an avatar: the first letters of the first and last names. */
export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function hashOf(text: string): number {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

const AVATAR_COLORS = ["#2f6f55", "#b4532a", "#2d6a9f", "#7a5338", "#6b4fa0", "#a8741a", "#3d7d6a", "#a2445e"];

function initialsAvatar(name: string, size: number): HTMLElement {
  const color = AVATAR_COLORS[hashOf(name) % AVATAR_COLORS.length];
  return h("span", { class: "avatar", title: name, style: `--size:${size}px;background:${color}` }, initials(name));
}

/** A round avatar: the person's picture, or their initials if they have none or it fails to load. */
export function avatar(face: Face, size = 32): HTMLElement {
  if (!face.avatar) return initialsAvatar(face.name, size);

  const holder = h("span", { class: "avatar has-picture", title: face.name, style: `--size:${size}px` });
  const image = h("img", { src: pictureUrl(face.avatar, "small"), alt: "", loading: "lazy", decoding: "async" });
  image.addEventListener("error", () => holder.replaceWith(initialsAvatar(face.name, size)));
  holder.appendChild(image);
  return holder;
}

/** Up to `most` overlapping avatars, then "+n". */
export function avatarStack(faces: Face[], size = 28, most = 5): HTMLElement {
  const shown: HTMLElement[] = faces.slice(0, most).map((face) => avatar(face, size));
  if (faces.length > most) {
    shown.push(h("span", { class: "avatar avatar-more", style: `--size:${size}px` }, `+${faces.length - most}`));
  }
  return h("div", { class: "avatar-stack" }, shown);
}

/** A calm two-tone gradient picked from `seed`, for tribes without a cover. */
export function gradientFor(seed: string): string {
  const hue = hashOf(seed) % 360;
  return `background: linear-gradient(135deg, hsl(${hue} 32% 34%), hsl(${(hue + 40) % 360} 38% 22%));`;
}

const TILE_SIZE = 256;

/** How many map tiles a thumbnail fetches across and down. */
export interface TileGrid {
  /** Tiles across; odd, so the point's tile sits in the middle. */
  columns: number;
  /** Tiles down. */
  rows: number;
}

/** Enough for a card: 768 by 512 pixels. */
const CARD_TILES: TileGrid = { columns: 3, rows: 2 };

/** Enough for a page-wide cover: 1792 by 768 pixels, so either side of the point reaches at least 640. */
const WIDE_TILES: TileGrid = { columns: 7, rows: 3 };

/** The first tile row, chosen so the point sits as near the middle as the rows allow. */
function firstRowFor(tileY: number, offsetY: number, rows: number): number {
  const above = Math.floor(rows / 2);
  const evenRows = rows % 2 === 0;
  const pointInTopHalf = offsetY < TILE_SIZE / 2;
  return evenRows && !pointInTopHalf ? tileY - above + 1 : tileY - above;
}

/** A map centred on a point, from OpenStreetMap tiles; the picture of an event without a cover. */
export function mapThumb(lat: number, lng: number, zoom = 12, grid: TileGrid = CARD_TILES): HTMLElement {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const radians = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;

  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const offsetX = (x - tileX) * TILE_SIZE;
  const offsetY = (y - tileY) * TILE_SIZE;
  const firstColumn = tileX - Math.floor(grid.columns / 2);
  const firstRow = firstRowFor(tileY, offsetY, grid.rows);

  const tiles: HTMLElement[] = [];
  for (let row = firstRow; row < firstRow + grid.rows; row += 1) {
    for (let column = firstColumn; column < firstColumn + grid.columns; column += 1) {
      const wrapped = ((column % scale) + scale) % scale;
      tiles.push(h("img", { src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${row}.png`, alt: "", loading: "lazy", decoding: "async" }));
    }
  }

  const pointX = (tileX - firstColumn) * TILE_SIZE + offsetX;
  const pointY = (tileY - firstRow) * TILE_SIZE + offsetY;
  const placement = `left: calc(50% - ${pointX.toFixed(1)}px); top: calc(50% - ${pointY.toFixed(1)}px); grid-template-columns: repeat(${grid.columns}, ${TILE_SIZE}px);`;
  const pin = '<svg viewBox="0 0 24 24"><path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="10" r="2.6" fill="#fff" stroke="none"/></svg>';

  return h("div", { class: "map-thumb" }, h("div", { class: "map-thumb-tiles", style: placement }, tiles), h("span", { class: "map-thumb-pin", html: pin }));
}

/** Optional parts of a cover. */
export interface CoverOptions {
  /** Which copy of the picture. */
  size?: PictureSize;
  /** Extra classes. */
  className?: string;
}

/** An event's picture: its cover, or a map of where it meets. */
export function eventCover(event: Event, options: CoverOptions = {}): HTMLElement {
  const picture = event.cover_image
    ? h("img", { src: pictureUrl(event.cover_image, options.size ?? "small"), alt: "", loading: "lazy", decoding: "async" })
    : mapThumb(event.meeting_point.lat, event.meeting_point.lng, 12, options.size === "large" ? WIDE_TILES : CARD_TILES);
  return h("div", { class: `cover ${options.className ?? ""}` }, picture);
}

/** A tribe's picture: its cover, or a gradient with its initials. */
export function tribeCover(tribe: Tribe, options: CoverOptions = {}): HTMLElement {
  const picture = tribe.cover_image
    ? h("img", { src: pictureUrl(tribe.cover_image, options.size ?? "small"), alt: "", loading: "lazy", decoding: "async" })
    : h("div", { class: "cover-fallback", style: gradientFor(tribe.id) }, h("span", { class: "monogram" }, initials(tribe.name)));
  return h("div", { class: `cover ${options.className ?? ""}` }, picture);
}
