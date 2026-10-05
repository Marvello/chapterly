import type { LibraryNovel } from "@/lib/db";
import { continueReading, displayTitle } from "@/lib/view";
import Cover from "./Cover";
import ReaderLink from "./ReaderLink";

/** Recently read novels; each opens straight at the reader's saved chapter. Nothing when none is started. */
export default function ContinueShelf({ novels }: { novels: LibraryNovel[] }) {
  const shelf = continueReading(novels);
  if (shelf.length === 0) return null;
  return (
    <section aria-labelledby="continue-reading" className="mb-4">
      <h2 id="continue-reading" className="mb-2 text-sm font-medium text-tmuted">Continue reading</h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {shelf.map(n => (
          <li key={n.id} className="w-20 shrink-0">
            <ReaderLink href={`/?novel=${n.id}&chapter=${n.progress_chapter_id}`} className="group block">
              <Cover url={n.cover_url} title={displayTitle(n)}
                className="aspect-[2/3] w-full rounded border border-edge text-[10px] group-hover:border-accent" />
              <p className="mt-1 line-clamp-2 text-xs leading-tight text-tprimary">{displayTitle(n)}</p>
              {!!n.unread && <p className="text-xs text-tmuted">{n.unread} unread</p>}
            </ReaderLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
