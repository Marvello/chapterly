/* eslint-disable @next/next/no-img-element -- covers are remote images from the novel's site */
import Link from "next/link";
import type { LibraryRow } from "@/lib/db";
import { displayTitle, fetchedPct, novelStatus } from "@/lib/view";

/** Cover grid. The bar under each cover is the share of chapters fetched (red on error). */
export default function NovelPosters({ novels }: { novels: LibraryRow[] }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
      {novels.map(n => {
        const error = novelStatus(n) === "error";
        return (
          <li key={n.id}>
            <Link href={`/novels/${n.id}`} title={displayTitle(n)}
              className="block overflow-hidden rounded-lg border border-edge bg-component hover:border-accent">
              <div className="relative aspect-[2/3] bg-edge">
                {n.cover_url && <img src={n.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                {n.chapters_new > 0 && (
                  <span className="absolute right-1 top-1 rounded bg-accent px-1 text-xs font-medium text-page">+{n.chapters_new}</span>
                )}
              </div>
              <div className="h-1 bg-edge">
                <div className={`h-full ${error ? "bg-critical" : "bg-accent"}`} style={{ width: `${error ? 100 : fetchedPct(n)}%` }} />
              </div>
              <div className="px-2 py-1.5 text-center">
                <p className="truncate text-xs font-medium text-tprimary">{displayTitle(n)}</p>
                <p className="text-xs tabular-nums text-tmuted">{n.chapters_fetched}/{n.chapters_total}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
