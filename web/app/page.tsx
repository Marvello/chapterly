import { cookies } from "next/headers";
import AddNovelForm from "@/components/AddNovelForm";
import AutoRefresh from "@/components/AutoRefresh";
import Header from "@/components/Header";
import LibraryControls from "@/components/LibraryControls";
import NovelPosters from "@/components/NovelPosters";
import NovelRow from "@/components/NovelRow";
import NovelTable from "@/components/NovelTable";
import ViewToggle from "@/components/ViewToggle";
import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { VIEW_COOKIE, libraryView, newSince, novelStatus, parseLibraryQuery, queryLibrary } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = libraryView((await cookies()).get(VIEW_COOKIE)?.value);
  const query = parseLibraryQuery(await searchParams);
  const uid = await currentUserId();
  const unread = new Map(uid ? getDb().readerLibrary(uid).filter(r => r.progress_chapter_id !== null).map(r => [r.id, r.unread]) : []);
  const all = getDb().listNovels(newSince()).map(n => ({ ...n, unread: unread.get(n.id) ?? null }));
  const novels = queryLibrary(all, query);
  // Only while the worker is actually on it (any novel, shown or not); gave-up chapters leave fetched < total forever.
  const live = all.some(n => ["fetching_info", "checking"].includes(novelStatus(n)));
  return (
    <main className="mx-auto max-w-6xl p-4">
      <AutoRefresh active={live} />
      {/* Stays at the top while the library scrolls underneath. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 border-b border-edge bg-page px-4 pt-4">
        <Header />
        <AddNovelForm />
      </div>
      {all.length === 0
        ? <p className="text-tmuted">No novels yet. Paste a novel&apos;s table-of-contents URL above.</p>
        : <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><LibraryControls query={query} /></div>
            <ViewToggle view={view} />
          </div>
          <p className="mb-3 text-sm text-tmuted">
            {novels.length === all.length ? `${all.length} novel${all.length === 1 ? "" : "s"}` : `${novels.length} of ${all.length} novels`}
          </p>
          {novels.length === 0 ? <p className="text-tmuted">No novels match.</p>
            : view === "table" ? <NovelTable novels={novels} />
              : view === "posters" ? <NovelPosters novels={novels} />
                : <ul className="space-y-3">{novels.map(n => <NovelRow key={n.id} novel={n} />)}</ul>}
        </>}
    </main>
  );
}
