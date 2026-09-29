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
export const VIEW_COOKIE = "library_view";
/** Cookie value → view; anything unknown falls back to the overview cards. */
export const libraryView = (v?: string): LibraryView =>
  (LIBRARY_VIEWS as readonly string[]).includes(v ?? "") ? (v as LibraryView) : "overview";

/** Share of chapters fetched, 0–100. */
export const fetchedPct = (n: Pick<LibraryRow, "chapters_fetched" | "chapters_total">) =>
  n.chapters_total ? Math.round((n.chapters_fetched / n.chapters_total) * 100) : 0;

export const displayTitle =(n: Pick<NovelRow, "title" | "toc_url">) => n.title || n.toc_url;

export function sortLibrary(rows: LibraryRow[]): LibraryRow[] {
  return [...rows].sort((a, b) =>
    Number(b.chapters_new > 0) - Number(a.chapters_new > 0) ||
    displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: "base" }));
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

/** Chapters fetched at/after this time count as "+N new" in the library (last 24 h). */
export const newSince = (now = Date.now()) => new Date(now - 86_400_000).toISOString();

/** Completed story with every chapter fetched: the worker no longer checks it (only "check now"). */
export const isSeriesDone = (n: Pick<LibraryRow, "series_status" | "chapters_total" | "chapters_fetched">) =>
  n.series_status === "completed" && n.chapters_total > 0 && n.chapters_fetched >= n.chapters_total;

const WEEK_MIN = 7 * 24 * 60;

/** When the worker will next check (same rule as worker/src/worker.js isDue): dropped → at least weekly. */
export function nextCheckAt(n: Pick<NovelRow, "last_checked_at" | "check_interval_min" | "series_status">): string | null {
  if (!n.last_checked_at) return null;
  const intervalMin = n.series_status === "dropped" ? Math.max(n.check_interval_min, WEEK_MIN) : n.check_interval_min;
  return new Date(Date.parse(n.last_checked_at) + intervalMin * 60_000).toISOString();
}
