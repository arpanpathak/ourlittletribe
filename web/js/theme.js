// Runs before the page draws, so it never flashes the wrong theme.
// A saved choice wins; otherwise the system setting is followed, live.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("olt-theme");
  } catch (error) {
    saved = null;
  }
  var query = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var theme = saved === "light" || saved === "dark" ? saved : query.matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  }
  apply();
  query.addEventListener("change", apply);
  /** The saved choice: "light", "dark", or null to follow the system. */
  window.oltThemeChoice = function () {
    return saved === "light" || saved === "dark" ? saved : null;
  };
  window.oltSetTheme = function (theme) {
    saved = theme;
    try {
      if (theme) localStorage.setItem("olt-theme", theme);
      else localStorage.removeItem("olt-theme");
    } catch (error) {
      /* storage can be blocked; the choice still holds for this visit */
    }
    apply();
    window.dispatchEvent(new CustomEvent("themechange"));
  };
})();
