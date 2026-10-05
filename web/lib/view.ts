import type { LibraryRow, NovelRow } from "./db";

export type Status = "paused" | "fetching_info" | "checking" | "error" | "active";

type StatusFields = Pick<NovelRow, "status" | "title" | "last_checked_at" | "check_finished_at" | "check_requested_at" | "last_error">;

/** A check is queued ("check now") or running (started after the last finish). */
export const isChecking = (n: StatusFields) =>
  !!n.check_requested_at || (!!n.last_checked_at && n.last_checked_at > (n.check_finished_at ?? ""));

export function novelStatus(n: StatusFields): Status {
  if (n.status === "paused") return "paused";
  if (!n.title && !n.check_finished_at) return "fetching_info";
  if (isChecking(n)) return "checking";
  if (n.last_error) return "error";
  return "active";
}

export const LIBRARY_VIEWS = ["overview", "table", "posters"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];
/** Cookie value → view; anything unknown falls back to the overview cards. */
export const libraryView = (v?: string): LibraryView =>
  (LIBRARY_VIEWS as readonly string[]).includes(v ?? "") ? (v as LibraryView) : "overview";

/** Share of chapters fetched, 0–100. */
export const fetchedPct = (n: Pick<LibraryRow, "chapters_fetched" | "chapters_total">) =>
  n.chapters_total ? Math.round((n.chapters_fetched / n.chapters_total) * 100) : 0;

export const displayTitle =(n: Pick<NovelRow, "title" | "toc_url">) => n.title || n.toc_url;

/** Default library order: novels with new chapters first, then by title. */
export const sortLibrary = (rows: LibraryRow[]) => queryLibrary(rows, { sort: "new", filter: "all", q: "" });

export const LIBRARY_SORTS = {
  new: "New first",
  title: "Title",
  updated: "Recently updated",
  added: "Recently added",
  chapters: "Most chapters",
} as const;
export const LIBRARY_FILTERS = {
  all: "All",
  new: "Has new chapters",
  ongoing: "Ongoing",
  completed: "Completed",
  dropped: "Dropped",
  error: "Errors",
  paused: "Paused",
} as const;
export type LibrarySort = keyof typeof LIBRARY_SORTS;
export type LibraryFilter = keyof typeof LIBRARY_FILTERS;
export interface LibraryQuery { sort: LibrarySort; filter: LibraryFilter; q: string }

const pick = <T extends string>(options: Record<T, string>, v: unknown, fallback: T): T =>
  typeof v === "string" && Object.hasOwn(options, v) ? (v as T) : fallback;

/** URL search params → query; anything unknown falls back to the defaults (new first, all, no search). */
export function parseLibraryQuery(p: Record<string, string | string[] | undefined>): LibraryQuery {
  const q = typeof p.q === "string" ? p.q.trim().slice(0, 100) : "";
  return { sort: pick(LIBRARY_SORTS, p.sort, "new"), filter: pick(LIBRARY_FILTERS, p.filter, "all"), q };
}

function matchesFilter(n: LibraryRow, f: LibraryFilter): boolean {
  switch (f) {
    case "all": return true;
    case "new": return n.chapters_new > 0;
    case "error": return novelStatus(n) === "error";
    case "paused": return n.status === "paused";
    default: return n.series_status === f;   // ongoing / completed / dropped
  }
}

const byTitle = (a: LibraryRow, b: LibraryRow) =>
  displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: "base" });
const desc = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

/** Filter, search (title / author, case-insensitive) and sort the library; ties fall back to title. */
export function queryLibrary(rows: LibraryRow[], { sort, filter, q }: LibraryQuery): LibraryRow[] {
  const needle = q.toLowerCase();
  const kept = rows.filter(n => matchesFilter(n, filter) &&
    (!needle || `${displayTitle(n)}\n${n.author ?? ""}`.toLowerCase().includes(needle)));
  const cmp: Record<LibrarySort, (a: LibraryRow, b: LibraryRow) => number> = {
    new: (a, b) => Number(b.chapters_new > 0) - Number(a.chapters_new > 0),
    title: () => 0,
    updated: (a, b) => desc(a.last_fetched_at, b.last_fetched_at),
    added: (a, b) => desc(a.created_at, b.created_at),
    chapters: (a, b) => b.chapters_total - a.chapters_total,
  };
  return [...kept].sort((a, b) => cmp[sort](a, b) || byTitle(a, b));
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - Date.parse(iso);
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  const [n, unit] = abs < 3_600_000 ? [abs / 60_000, "m"] : abs < 86_400_000 ? [abs / 3_600_000, "h"] : [abs / 86_400_000, "d"];
  const v = Math.floor(n);
  return diff >= 0 ? `${v}${unit} ago` : `in ${v}${unit}`;
}

/** "next in 3h", or "due now" once that time has passed (instead of "next 6d ago"). */
export const nextCheckLabel = (iso: string, now = Date.now()) =>
  Date.parse(iso) <= now ? "due now" : `next ${relativeTime(iso, now)}`;

/**
 * The worker stamps a heartbeat every tick (and per chapter while a long check runs): none for 3 ticks → not
 * running. At least 10 min, as one chapter fetch can take minutes (timeout + throttle).
 */
export const workerDown = (seenAt: string | null, tickMin: number, now = Date.now()) =>
  !seenAt || now - Date.parse(seenAt) > Math.max(3 * tickMin, 10) * 60_000;

/** Chapters fetched at/after this time count as "+N new" in the library (last 24 h). */
export const newSince = (now = Date.now()) => new Date(now - 86_400_000).toISOString();

/** Completed story with every chapter fetched: the worker no longer checks it (only "check now"). */
export const isSeriesDone = (n: Pick<LibraryRow, "series_status" | "chapters_total" | "chapters_fetched">) =>
  n.series_status === "completed" && n.chapters_total > 0 && n.chapters_fetched >= n.chapters_total;

const WEEK_MIN = 7 * 24 * 60;

/**
 * When the worker will next check (same rule as worker/src/worker.js isDue): dropped → at least weekly,
 * or earlier when a failed check or chapter is due for a retry (a failed check's backoff holds chapter retries back).
 */
export function nextCheckAt(
  n: Pick<NovelRow, "last_checked_at" | "check_interval_min" | "series_status"> &
    { check_retry_at?: string | null; next_retry_at?: string | null },
): string | null {
  if (!n.last_checked_at) return null;
  const intervalMin = n.series_status === "dropped" ? Math.max(n.check_interval_min, WEEK_MIN) : n.check_interval_min;
  const scheduled = new Date(Date.parse(n.last_checked_at) + intervalMin * 60_000).toISOString();
  const retryAt = n.check_retry_at || n.next_retry_at;
  return retryAt && retryAt < scheduled ? retryAt : scheduled;
}
