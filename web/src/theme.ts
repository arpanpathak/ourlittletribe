// Runs as a classic script in <head>, before the page draws, so it never
// flashes the wrong theme. A saved choice wins; otherwise the system setting
// is followed, live.

(function startTheme(): void {
  type Choice = "light" | "dark" | null;

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let saved: Choice = readSaved();

  function readSaved(): Choice {
    try {
      const stored = localStorage.getItem("olt-theme");
      return stored === "light" || stored === "dark" ? stored : null;
    } catch {
      return null;
    }
  }

  function store(choice: Choice): void {
    try {
      if (choice) localStorage.setItem("olt-theme", choice);
      else localStorage.removeItem("olt-theme");
    } catch {
      // Storage can be blocked; the choice still holds for this visit.
    }
  }

  function apply(): void {
    const theme = saved ?? (darkQuery.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  }

  apply();
  darkQuery.addEventListener("change", apply);

  window.oltThemeChoice = () => saved;
  window.oltSetTheme = (choice: Choice) => {
    saved = choice;
    store(choice);
    apply();
    window.dispatchEvent(new CustomEvent("themechange"));
  };
})();
