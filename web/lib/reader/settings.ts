// Display preferences for this device only (localStorage; may be unavailable, so every access is guarded).
// "system" follows the OS through the CSS tokens (globals.css switches them by prefers-color-scheme), so it
// needs no JS and the server render already matches; light/dark mirror those tokens' two palettes.
export const THEMES = {
  system: { background: "var(--page)", color: "var(--tprimary)" },
  light: { background: "#faf7f2", color: "#2a2420" },
  sepia: { background: "#f4ecd8", color: "#5b4636" },
  dark: { background: "#1c1916", color: "#f3ece2" },
} as const;
export const FONTS = { serif: "var(--font-serif)", sans: "inherit" } as const;   // sans = the UI font
export const WIDTHS = { narrow: "32rem", normal: "42rem", wide: "52rem" } as const;
export const FONT_SIZE = { min: 14, max: 28 };
export const LINE_HEIGHT = { min: 1.3, max: 2.2 };

export type ReaderSettings = {
  fontSize: number; lineHeight: number; theme: keyof typeof THEMES; font: keyof typeof FONTS; width: keyof typeof WIDTHS;
};
type KV = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_SETTINGS: ReaderSettings = { fontSize: 18, lineHeight: 1.7, theme: "system", font: "serif", width: "normal" };
const KEY = "chapterly-reader-settings";

const oneOf = <T extends string>(v: unknown, options: Record<T, unknown>, d: T): T =>
  typeof v === "string" && Object.hasOwn(options, v) ? (v as T) : d;
const inRange = (v: unknown, r: { min: number; max: number }, d: number) =>
  typeof v === "number" && v >= r.min && v <= r.max ? v : d;

/** Stored settings, each field checked on its own: older versions (fewer fields) or bad values keep the rest. */
export function loadSettings(storage: KV | undefined = globalThis.localStorage): ReaderSettings {
  try {
    const s = JSON.parse(storage?.getItem(KEY) ?? "{}"), d = DEFAULT_SETTINGS;
    return {
      fontSize: inRange(s.fontSize, FONT_SIZE, d.fontSize),
      lineHeight: inRange(s.lineHeight, LINE_HEIGHT, d.lineHeight),
      theme: oneOf(s.theme, THEMES, d.theme),
      font: oneOf(s.font, FONTS, d.font),
      width: oneOf(s.width, WIDTHS, d.width),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ReaderSettings, storage: KV | undefined = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* not remembered; still applied this session */ }
}

// For useSyncExternalStore: the server (no localStorage) renders the defaults, the client re-renders with
// the stored settings after hydration. `current` keeps changes even when storage is unavailable.
let current: ReaderSettings | null = null;
const listeners = new Set<() => void>();
export const settingsStore = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get: (): ReaderSettings => (current ??= loadSettings()),
  getServer: (): ReaderSettings => DEFAULT_SETTINGS,
  set(s: ReaderSettings) { current = s; saveSettings(s); listeners.forEach(l => l()); },
};
