import type { LibraryRow } from "@/lib/db";
import { displayTitle, fetchedPct, novelStatus, relativeTime } from "@/lib/view";
import Cover from "./Cover";
import ReaderLink from "./ReaderLink";
import StatusBadge, { NewDot, UnreadPill } from "./StatusBadge";

/** online=false hides what is stale without the server (check status, last error, failing count, last check). */
export default function NovelRow({ novel: n, online = true }: { novel: LibraryRow; online?: boolean }) {
  const status = novelStatus(n);
  const pct = fetchedPct(n);
  return (
    <li>
      <ReaderLink href={`/?novel=${n.id}`} className="flex gap-3 rounded-xl border border-edge bg-component p-3 hover:border-accent">
        <Cover url={n.cover_url} title={displayTitle(n)} className="h-20 w-14 shrink-0 rounded text-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-1.5 font-medium text-tprimary">
              <span className="truncate">{displayTitle(n)}</span>
              {n.chapters_new > 0 && <NewDot count={n.chapters_new} />}
            </h2>
            {online && <StatusBadge status={status} />}
          </div>
          {n.author && <p className="truncate text-sm text-tmuted">{n.author}</p>}
          {online && n.last_error && <p className="line-clamp-1 break-all text-xs text-critical" title={n.last_error}>{n.last_error}</p>}
          {n.description && <p className="mt-1 line-clamp-2 text-sm text-tsecondary">{n.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tmuted">
            {!!n.unread && <UnreadPill count={n.unread} />}
            <span className="tabular-nums">{n.chapters_fetched}/{n.chapters_total} chapters</span>
            {online && n.chapters_failing > 0 && <span className="text-critical">{n.chapters_failing} failing</span>}
            {n.series_status !== "ongoing" && <span className="rounded border border-edge px-1.5">{n.series_status}</span>}
            {online && <span>checked {relativeTime(n.last_checked_at)}</span>}
          </div>
          {n.chapters_fetched < n.chapters_total && (
            <div role="progressbar" aria-label="Chapters fetched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              className="mt-2 h-1 overflow-hidden rounded bg-edge">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </ReaderLink>
    </li>
  );
}
