// Library layout (overview / table / posters), remembered per device. Same shape as settingsStore so it
// works with useSyncExternalStore: the server renders the default, the client its stored choice.
import { libraryView, type LibraryView } from "@/lib/view";

type KV = Pick<Storage, "getItem" | "setItem">;
const KEY = "chapterly-library-view";

const phone = () => !!globalThis.matchMedia?.("(max-width: 640px)").matches;

/** Nothing chosen yet: posters on a phone, the overview cards elsewhere. */
export function createViewPref(storage: KV | undefined = globalThis.localStorage, narrow = phone) {
  let current: LibraryView | null = null;
  const listeners = new Set<() => void>();
  const read = (): LibraryView => {
    try {
      const v = storage?.getItem(KEY);
      return v == null ? (narrow() ? "posters" : "overview") : libraryView(v);
    } catch { return "overview"; }
  };
  return {
    subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    get: (): LibraryView => (current ??= read()),
    getServer: (): LibraryView => "overview",
    set(v: LibraryView) {
      current = v;
      try { storage?.setItem(KEY, v); } catch { /* not remembered; still applied this session */ }
      listeners.forEach(l => l());
    },
  };
}

export const viewPref = createViewPref();
