import Link from "next/link";
import type { LibraryRow } from "@/lib/db";
import { displayTitle, novelStatus, relativeTime } from "@/lib/view";
import StatusBadge from "./StatusBadge";

/** Compact one-line-per-novel layout for large libraries. */
export default function NovelTable({ novels }: { novels: LibraryRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-component">
      <table className="w-full table-fixed text-sm">
        <thead className="border-b border-edge text-left text-xs text-tmuted">
          <tr>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="hidden w-1/5 px-3 py-2 font-medium md:table-cell">Author</th>
            <th className="w-32 px-3 py-2 font-medium">Chapters</th>
            <th className="hidden w-28 px-3 py-2 font-medium sm:table-cell">Checked</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {novels.map(n => (
            <tr key={n.id} className="border-b border-edge last:border-0 hover:bg-page/40">
              <td className="truncate px-3 py-2">
                <Link href={`/novels/${n.id}`} className="text-tprimary hover:text-accent">{displayTitle(n)}</Link>
              </td>
              <td className="hidden truncate px-3 py-2 text-tmuted md:table-cell">{n.author}</td>
              <td className="px-3 py-2 tabular-nums text-tmuted">
                {n.chapters_fetched}/{n.chapters_total}
                {n.chapters_new > 0 && <span className="ml-1.5 rounded bg-accent px-1 text-xs font-medium text-page">+{n.chapters_new}</span>}
                {!!n.unread && <span className="ml-1.5 whitespace-nowrap rounded border border-accent px-1 text-xs font-medium text-accent">{n.unread} unread</span>}
                {n.chapters_failing > 0 && <span className="ml-1.5 text-xs text-critical">{n.chapters_failing}✗</span>}
              </td>
              <td className="hidden px-3 py-2 text-tmuted sm:table-cell">{relativeTime(n.last_checked_at)}</td>
              <td className="px-3 py-2 text-right"><StatusBadge status={novelStatus(n)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
