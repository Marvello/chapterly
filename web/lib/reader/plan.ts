// Which chapters to keep on the phone. toc is in (idx, id) order and holds fetched chapters only,
// which is also the order /chapters?after= pages through, so a run is fetched as (after, count).
import type { TocEntry } from "@/lib/db";
import type { Position } from "./types";

export type CachePlan = { fetch: { after: number | null; count: number }[]; evict: number[] };

export function planCache(toc: TocEntry[], cached: Set<number>, progress: Position | null, pinned: boolean,
  { ahead = 50, keepBehind = 20, batch = 200 } = {}): CachePlan {
  if (!progress && !pinned) return { fetch: [], evict: [] };
  const start = Math.max(0, progress ? toc.findIndex(c => c.id === progress.chapterId) : 0);
  const end = pinned ? toc.length : Math.min(toc.length, start + 1 + ahead);
  const fetch: CachePlan["fetch"] = [];
  let run: CachePlan["fetch"][number] | null = null;
  for (let i = start; i < end; i++) {
    if (cached.has(toc[i].id)) { run = null; continue; }
    if (!run || run.count === batch) {
      run = { after: i > 0 ? toc[i - 1].id : null, count: 0 };
      fetch.push(run);
    }
    run.count++;
  }
  const evict = toc.slice(0, Math.max(0, start - keepBehind)).map(c => c.id).filter(id => cached.has(id));
  return { fetch, evict };
}
