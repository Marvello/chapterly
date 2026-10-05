// Progress only moves forward on its own; moving back needs the reader's confirmation (force).
import type { ReaderNovel, TocEntry } from "@/lib/db";
import type { OutboxEntry, Position } from "./types";

type Ordered = Pick<Position, "chapterId" | "idx" | "fraction">;

export const compare = (a: Ordered, b: Ordered): number =>
  a.idx - b.idx || a.chapterId - b.chapterId || a.fraction - b.fraction;

export function savedFromLibrary(n: ReaderNovel): Position | null {
  if (n.progress_chapter_id === null || n.progress_idx === null) return null;
  return { novelId: n.id, chapterId: n.progress_chapter_id, idx: n.progress_idx, fraction: n.progress_fraction ?? 0 };
}

/** What this device treats as saved: the further of server and pending, unless pending is a confirmed move back. */
export function savedProgress(stored: Position | null, pending: OutboxEntry | null): Position | null {
  const p = pending ? { novelId: pending.novelId, chapterId: pending.chapterId, idx: pending.idx, fraction: pending.fraction } : null;
  if (!p) return stored;
  if (pending!.force || !stored) return p;
  return compare(p, stored) >= 0 ? p : stored;
}

export const mergeOutbox = (prev: OutboxEntry | undefined, next: OutboxEntry): OutboxEntry =>
  ({ ...next, force: next.force || !!prev?.force });

export function decide(current: Position, saved: Position | null): "save" | "behind" | "same" {
  if (!saved) return "save";
  const c = compare(current, saved);
  return c > 0 ? "save" : c < 0 ? "behind" : "same";
}

export function chapterState(c: TocEntry, saved: Position | null): "read" | "current" | "unread" {
  if (!saved) return "unread";
  if (c.id === saved.chapterId) return "current";
  return compare({ chapterId: c.id, idx: c.idx, fraction: 0 }, { ...saved, fraction: 0 }) < 0 ? "read" : "unread";
}

/** Started novels with unread chapters first (most recently read first), then the rest by title. */
export function sortReaderLibrary(list: ReaderNovel[]): ReaderNovel[] {
  const reading = (n: ReaderNovel) => n.progress_chapter_id !== null && n.unread > 0;
  return [...list].sort((a, b) =>
    Number(reading(b)) - Number(reading(a)) ||
    (reading(a) ? (b.read_at ?? "").localeCompare(a.read_at ?? "") : 0) ||
    (a.title ?? a.toc_url).localeCompare(b.title ?? b.toc_url));
}
