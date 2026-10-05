// Display preferences for this device only (localStorage; may be unavailable, so every access is guarded).
export type ReaderSettings = { fontSize: number; lineHeight: number; theme: "light" | "dark" | "sepia" };
type KV = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_SETTINGS: ReaderSettings = { fontSize: 18, lineHeight: 1.7, theme: "dark" };
export const THEMES = {
  light: { background: "#ffffff", color: "#1f2937" },
  dark: { background: "#0b1120", color: "#e2e8f0" },
  sepia: { background: "#f4ecd8", color: "#5b4636" },
} as const;
const KEY = "chapterly-reader-settings";

export function loadSettings(storage: KV | undefined = globalThis.localStorage): ReaderSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(storage?.getItem(KEY) ?? "{}") };
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
