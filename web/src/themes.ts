// Every theme the app offers, and the picker that chooses one. The colours
// themselves live in app.css under [data-palette]; the swatches here only
// draw the previews.

import { h } from "./dom.js";
import { icon } from "./icons.js";
import { openModal } from "./ui/modal.js";

/** One theme in the picker. */
interface Theme {
  /** The palette's name in the stylesheet. */
  palette: string;
  /** Its name in the picker. */
  name: string;
  /** Whether its background is light or dark. */
  mode: "light" | "dark";
  /** Colours for the preview: background, surface, text, accent. */
  swatch: [string, string, string, string];
}

export const THEMES: Theme[] = [
  { palette: "evergreen", name: "Evergreen", mode: "light", swatch: ["#f7f7f5", "#ffffff", "#191c1a", "#1f6f4e"] },
  { palette: "rose-pine-dawn", name: "Rosé Pine Dawn", mode: "light", swatch: ["#faf4ed", "#fffaf3", "#575279", "#286983"] },
  { palette: "evergreen-dark", name: "Evergreen Dark", mode: "dark", swatch: ["#0e1110", "#161a18", "#ecefed", "#3dae7c"] },
  { palette: "deep-ocean", name: "Material Deep Ocean", mode: "dark", swatch: ["#090b10", "#0f111a", "#eeffff", "#82aaff"] },
  { palette: "night-owl", name: "Night Owl", mode: "dark", swatch: ["#010e1a", "#011627", "#d6deeb", "#7fdbca"] },
  { palette: "oceanic-next", name: "Oceanic Next", mode: "dark", swatch: ["#16232b", "#1b2b34", "#d8dee9", "#5fb3b3"] },
  { palette: "nord", name: "Nord", mode: "dark", swatch: ["#242933", "#2e3440", "#eceff4", "#88c0d0"] },
  { palette: "catppuccin", name: "Catppuccin Mocha", mode: "dark", swatch: ["#11111b", "#1e1e2e", "#cdd6f4", "#cba6f7"] },
  { palette: "tokyo-night", name: "Tokyo Night", mode: "dark", swatch: ["#16161e", "#1a1b26", "#c0caf5", "#7aa2f7"] },
  { palette: "kanagawa", name: "Kanagawa", mode: "dark", swatch: ["#16161d", "#1f1f28", "#dcd7ba", "#7fb4ca"] },
  { palette: "rose-pine", name: "Rosé Pine", mode: "dark", swatch: ["#13111e", "#191724", "#e0def4", "#ebbcba"] },
  { palette: "everforest", name: "Everforest", mode: "dark", swatch: ["#232a2e", "#2d353b", "#d3c6aa", "#a7c080"] },
];

/** The theme showing now. */
export function currentTheme(): Theme {
  const palette = document.documentElement.dataset.palette;
  return THEMES.find((theme) => theme.palette === palette) ?? THEMES[0]!;
}

/** A small picture of a theme: its background with a card, text lines and an accent bar. */
function preview(theme: Theme): HTMLElement {
  const [background, surface, text, accent] = theme.swatch;

  return h("div", { class: "theme-preview", style: `background:${background}` },
    h("span", { style: `background:${surface};height:22px;width:100%` }),
    h("span", { style: `background:${text};width:60%;opacity:.8` }),
    h("span", { style: `background:${accent};width:36%` }));
}

function option(theme: Theme, chosen: boolean, choose: () => void): HTMLElement {
  return h("button", { type: "button", class: "theme-option", "aria-pressed": String(chosen), onclick: choose },
    preview(theme),
    h("span", { class: "theme-name" }, theme.name),
    h("span", { class: "theme-mode" }, theme.mode === "dark" ? "Dark" : "Light"));
}

/** Opens the theme picker. */
export function openThemePicker(): void {
  const following = window.oltThemeChoice() === null;
  const showing = currentTheme().palette;

  void openModal<void>({
    title: "Appearance",
    wide: true,
    build: (close) => {
      const choose = (theme: Theme | null) => {
        window.oltSetTheme(theme ? { palette: theme.palette, mode: theme.mode } : null);
        close();
      };

      const auto = h("button", { type: "button", class: following ? "btn btn-soft" : "btn", onclick: () => choose(null) }, icon("monitor", "sm"), "Follow my device: Evergreen, light or dark");
      const grid = h("div", { class: "theme-grid" }, THEMES.map((theme) => option(theme, !following && theme.palette === showing, () => choose(theme))));
      return h("div", { class: "stack" }, auto, grid);
    },
  });
}

/** The sidebar's button: the theme's name and colours; opens the picker. */
export function themeButton(): HTMLElement {
  const theme = currentTheme();
  const dots = h("span", { class: "theme-dots" }, theme.swatch.slice(1).map((colour) => h("span", { style: `background:${colour}` })));

  return h("button", { type: "button", class: "theme-button", onclick: openThemePicker }, icon(theme.mode === "dark" ? "moon" : "sun", "sm"), theme.name, dots);
}
