// Leaflet is loaded as a classic script before the app, as the global `L`.
import type * as Leaflet from "leaflet";

declare global {
  const L: typeof Leaflet;

  interface Window {
    /** Sets the theme: "light", "dark", or null to follow the system. Defined by theme.ts. */
    oltSetTheme: (theme: "light" | "dark" | null) => void;
    /** The saved theme choice, or null when following the system. Defined by theme.ts. */
    oltThemeChoice: () => "light" | "dark" | null;
  }
}

export {};
