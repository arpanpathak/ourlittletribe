// Leaflet is loaded as a classic script before the app, as the global `L`.
import type * as Leaflet from "leaflet";

declare global {
  const L: typeof Leaflet;

  /** A theme: its palette's name and whether it is light or dark. */
  interface OltTheme {
    /** The palette's name, such as "nord". */
    palette: string;
    /** Whether its background is light or dark. */
    mode: "light" | "dark";
  }

  interface Window {
    /** Sets the theme, or null to follow the system with Evergreen. Defined by theme.ts. */
    oltSetTheme: (theme: OltTheme | null) => void;
    /** The saved theme, or null when following the system. Defined by theme.ts. */
    oltThemeChoice: () => OltTheme | null;
  }
}

export {};
