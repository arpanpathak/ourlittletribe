// Runs as a classic script in <head>, before the page draws, so it never
// flashes the wrong theme. A saved theme wins; otherwise the Evergreen theme
// follows the system's light or dark setting, live.
//
// A theme is a palette (its colours, such as "nord") and a mode ("light" or
// "dark", which the illustrations and the map follow). The list of themes
// lives in themes.ts; this script only applies the one it is given.

(function startTheme(): void {
  /** A saved theme. */
  interface Saved {
    /** The palette's name, such as "nord". */
    palette: string;
    /** Whether its background is light or dark. */
    mode: "light" | "dark";
  }

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let saved: Saved | null = readSaved();

  /** The saved theme. Choices saved before palettes existed were just "light" or "dark". */
  function readSaved(): Saved | null {
    try {
      const palette = localStorage.getItem("olt-theme");
      const mode = localStorage.getItem("olt-theme-mode");

      if (palette === "light") return { palette: "evergreen", mode: "light" };
      if (palette === "dark") return { palette: "evergreen-dark", mode: "dark" };
      if (palette && (mode === "light" || mode === "dark")) return { palette, mode };
      return null;
    } catch {
      return null;
    }
  }

  function store(theme: Saved | null): void {
    try {
      if (!theme) {
        localStorage.removeItem("olt-theme");
        localStorage.removeItem("olt-theme-mode");
        return;
      }

      localStorage.setItem("olt-theme", theme.palette);
      localStorage.setItem("olt-theme-mode", theme.mode);
    } catch {
      // Storage can be blocked; the choice still holds for this visit.
    }
  }

  function apply(): void {
    const systemDark = darkQuery.matches;
    const theme = saved ?? { palette: systemDark ? "evergreen-dark" : "evergreen", mode: systemDark ? "dark" : "light" };

    document.documentElement.dataset.theme = theme.mode;
    document.documentElement.dataset.palette = theme.palette;
  }

  apply();
  darkQuery.addEventListener("change", apply);

  window.oltThemeChoice = () => saved;
  window.oltSetTheme = (theme) => {
    saved = theme;
    store(theme);
    apply();
    window.dispatchEvent(new CustomEvent("themechange"));
  };
})();
