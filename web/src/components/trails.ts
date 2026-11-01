// The Trails card on an event page: named hiking routes and paths near where
// the event happens, each with its length, climb and difficulty. Choosing one
// draws it on the event's map and shows its elevation profile.

import { events } from "../api/client.js";
import type { Difficulty, Trail } from "../api/types.js";
import { h, mount } from "../dom.js";
import { climbHeight, height, shortDistance, trailLength } from "../format.js";
import { icon } from "../icons.js";
import { errorMessage } from "../ui/feedback.js";

/** How each grade is worded and coloured. */
const DIFFICULTY_WORDS: Record<Difficulty, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  alpine: "Alpine",
};

/** The profile drawing's size in its own units. */
const PROFILE_WIDTH = 600;
const PROFILE_HEIGHT = 120;

/** What the card does with a chosen trail, such as drawing it on the map. */
export type ShowTrail = (trail: Trail | null) => void;

function difficultyBadge(difficulty: Difficulty | null): HTMLElement | null {
  if (!difficulty) return null;
  return h("span", { class: `badge trail-grade trail-${difficulty}` }, DIFFICULTY_WORDS[difficulty]);
}

/** The heights as a filled line, lowest at the bottom and highest at the top. */
function profileSvg(heights: number[]): string {
  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);
  const range = Math.max(highest - lowest, 1);

  const points = heights.map((metres, index) => {
    const x = (index / Math.max(heights.length - 1, 1)) * PROFILE_WIDTH;
    const y = PROFILE_HEIGHT - 8 - ((metres - lowest) / range) * (PROFILE_HEIGHT - 20);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = points.join(" ");
  const area = `0,${PROFILE_HEIGHT} ${line} ${PROFILE_WIDTH},${PROFILE_HEIGHT}`;
  return `<svg viewBox="0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
<polygon points="${area}" class="profile-fill"/><polyline points="${line}" class="profile-line"/></svg>`;
}

/** The chosen trail's profile, highest and lowest points, and a link to the map. */
function details(trail: Trail): HTMLElement {
  const climb = trail.climb;
  const facts = climb
    ? h("div", { class: "fact-row" },
        h("div", { class: "fact" }, icon("mountain", "sm"), h("span", { class: "muted" }, "High point"), h("b", {}, height(climb.highest_m))),
        h("div", { class: "fact" }, icon("chevronDown", "sm"), h("span", { class: "muted" }, "Descent"), h("b", {}, `about ${climbHeight(climb.loss_m)}`)))
    : null;

  const profile = trail.profile.length > 1 ? h("div", { class: "trail-profile", html: profileSvg(trail.profile) }) : null;
  const link = h("a", { class: "small", href: `https://www.openstreetmap.org/${trail.osm_ref}`, target: "_blank", rel: "noopener" }, "Open on OpenStreetMap");

  return h("div", { class: "trail-details" }, profile, facts, link);
}

/** One trail in the list; the chosen one shows its details. */
function trailRow(trail: Trail, chosen: boolean, choose: () => void): HTMLElement {
  const climb = trail.climb ? `↑ about ${climbHeight(trail.climb.gain_m)}` : null;
  const away = trail.distance_km < 0.3 ? "starts here" : `${shortDistance(trail.distance_km)} away`;

  const head = h("button", { type: "button", class: "trail-head", "aria-expanded": String(chosen), onclick: choose },
    h("span", { class: "trail-icon" }, icon(trail.is_route ? "route" : "navigation", "sm")),
    h("div", { class: "grow" },
      h("div", { class: "strong ellipsis" }, trail.name),
      h("div", { class: "small muted trail-meta" }, h("span", {}, trailLength(trail.length_km)), climb ? h("span", {}, climb) : null, h("span", {}, away))),
    difficultyBadge(trail.difficulty));

  return h("li", { class: chosen ? "trail chosen" : "trail" }, head, chosen ? details(trail) : null);
}

/** The Trails card. */
export class TrailsCard {
  /** The card, to put on the page. */
  readonly element: HTMLElement;

  private readonly body = h("div", { class: "card-body" });
  private trails: Trail[] = [];
  private chosen: string | null = null;

  constructor(private readonly eventId: string, private readonly show: ShowTrail) {
    const head = h("div", { class: "card-head" },
      h("div", {}, h("h3", {}, "Trails nearby"), h("div", { class: "small muted" }, "Marked routes and paths from OpenStreetMap")),
      icon("route"));
    this.element = h("section", { class: "card trails-card" }, head, this.body);

    void this.load();
  }

  private async load(): Promise<void> {
    mount(this.body, h("div", { class: "thinking" }, h("span", { class: "spinner" }), "Finding trails and measuring their climbs…"));

    try {
      this.trails = await events.trails(this.eventId);
      this.draw();
    } catch (error) {
      mount(this.body, h("p", { class: "small muted" }, `No trails right now: ${errorMessage(error)}`));
    }
  }

  private choose(trail: Trail): void {
    const again = this.chosen === trail.osm_ref;
    this.chosen = again ? null : trail.osm_ref;

    this.show(again ? null : trail);
    this.draw();
  }

  private draw(): void {
    if (!this.trails.length) {
      mount(this.body, h("p", { class: "small muted" }, "OpenStreetMap has no named trails within 4 km of where this event happens."));
      return;
    }

    const rows = this.trails.map((trail) => trailRow(trail, trail.osm_ref === this.chosen, () => this.choose(trail)));
    const source = h("p", { class: "tiny muted" }, "Climbs are estimated from Open-Meteo's 90 m elevation grid. Routes from Waymarked Trails.");
    mount(this.body, h("ul", { class: "trails" }, rows), source);
  }
}
