// Chapter list order, remembered per device in a cookie (the manage page is server-rendered and reads it
// there). Same shape as viewPref so it works with useSyncExternalStore; the server renders the default.
import { CHAPTER_ORDER_COOKIE, chapterOrder, type ChapterOrder } from "@/lib/view";

const listeners = new Set<() => void>();
const pattern = new RegExp(`(?:^|; )${CHAPTER_ORDER_COOKIE}=(\\w+)`);

export const orderPref = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  get: (): ChapterOrder => chapterOrder(globalThis.document?.cookie.match(pattern)?.[1]),
  getServer: (): ChapterOrder => "desc",
  set(v: ChapterOrder) {
    document.cookie = `${CHAPTER_ORDER_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
    listeners.forEach(l => l());
  },
};
