import { AlertTriangle } from "lucide-react";
import type { LibraryRow } from "@/lib/db";
import { displayTitle, fetchedPct, novelStatus } from "@/lib/view";
import Cover from "./Cover";
import ReaderLink from "./ReaderLink";
import { NewDot, UnreadPill } from "./StatusBadge";

/** Cover grid. The bar under each cover is the share of chapters fetched (red, plus a warning icon, on error). */
export default function NovelPosters({ novels, online = true }: { novels: LibraryRow[]; online?: boolean }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
      {novels.map(n => {
        const error = online && novelStatus(n) === "error";
        const title = displayTitle(n);
        const pct = fetchedPct(n);
        return (
          <li key={n.id}>
            <ReaderLink href={`/?novel=${n.id}`} title={error && n.last_error ? `${title}\nCheck failed: ${n.last_error}` : title}
              className="block overflow-hidden rounded-lg border border-edge bg-component hover:border-accent">
              <div className="relative aspect-[2/3]">
                <Cover url={n.cover_url} title={title} className="h-full w-full text-sm" />
                {!!n.unread && <UnreadPill count={n.unread} className="absolute left-1 top-1" />}
                {n.chapters_new > 0 && <NewDot count={n.chapters_new} className="absolute right-1.5 top-1.5 size-2.5 ring-2 ring-page" />}
                {error && (
                  <span className="absolute bottom-1 right-1 rounded-full bg-page p-1">
                    <AlertTriangle role="img" aria-label="Check failed" className="size-3.5 text-critical" />
                  </span>
                )}
              </div>
              <div role="progressbar" aria-label="Chapters fetched" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 bg-edge">
                <div className={`h-full ${error ? "bg-critical" : "bg-accent"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="px-2 py-1.5 text-center">
                <p className="truncate text-xs font-medium text-tprimary">{title}</p>
                <p className="text-xs tabular-nums text-tmuted">{n.chapters_fetched}/{n.chapters_total}<span className="sr-only"> chapters</span></p>
              </div>
            </ReaderLink>
          </li>
        );
      })}
    </ul>
  );
}
