/* eslint-disable @next/next/no-img-element -- covers are remote images from the novel's site */
import Link from "next/link";
import type { LibraryRow } from "@/lib/db";
import { displayTitle, fetchedPct, novelStatus, relativeTime } from "@/lib/view";
import StatusBadge from "./StatusBadge";

export default function NovelRow({ novel: n }: { novel: LibraryRow }) {
  const status = novelStatus(n);
  const pct = fetchedPct(n);
  return (
    <li>
      <Link href={`/novels/${n.id}`} className="flex gap-3 rounded-xl border border-edge bg-component p-3 hover:border-accent">
        {n.cover_url
          ? <img src={n.cover_url} alt="" className="h-20 w-14 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
          : <div className="h-20 w-14 shrink-0 rounded bg-edge" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="truncate font-medium text-tprimary">{displayTitle(n)}</h2>
            <StatusBadge status={status} />
          </div>
          {n.author && <p className="truncate text-sm text-tmuted">{n.author}</p>}
          {n.description && <p className="mt-1 line-clamp-2 text-sm text-tsecondary">{n.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tmuted">
            <span className="tabular-nums">{n.chapters_fetched}/{n.chapters_total} chapters</span>
            {n.chapters_new > 0 && <span className="rounded bg-accent px-1.5 font-medium text-page">+{n.chapters_new} new</span>}
            {n.chapters_failing > 0 && <span className="text-critical">{n.chapters_failing} failing</span>}
            {n.series_status !== "ongoing" && <span className="rounded border border-edge px-1.5">{n.series_status}</span>}
            <span>checked {relativeTime(n.last_checked_at)}</span>
          </div>
          {n.chapters_fetched < n.chapters_total && (
            <div className="mt-2 h-1 overflow-hidden rounded bg-edge">
              <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
