import { cookies } from "next/headers";
import AddNovelForm from "@/components/AddNovelForm";
import AutoRefresh from "@/components/AutoRefresh";
import Header from "@/components/Header";
import NovelPosters from "@/components/NovelPosters";
import NovelRow from "@/components/NovelRow";
import NovelTable from "@/components/NovelTable";
import ViewToggle from "@/components/ViewToggle";
import { getDb } from "@/lib/db";
import { VIEW_COOKIE, libraryView, newSince, novelStatus, sortLibrary } from "@/lib/view";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const view = libraryView((await cookies()).get(VIEW_COOKIE)?.value);
  const novels = sortLibrary(getDb().listNovels(newSince()));
  // Only while the worker is actually on it; gave-up chapters leave fetched < total forever.
  const live = novels.some(n => ["fetching_info", "checking"].includes(novelStatus(n)));
  return (
    <main className="mx-auto max-w-6xl p-4">
      <AutoRefresh active={live} />
      {/* Stays at the top while the library scrolls underneath. */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 border-b border-edge bg-page px-4 pt-4">
        <Header />
        <AddNovelForm />
      </div>
      {novels.length === 0
        ? <p className="text-tmuted">No novels yet. Paste a novel&apos;s table-of-contents URL above.</p>
        : <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm text-tmuted">{novels.length} novel{novels.length === 1 ? "" : "s"}</span>
            <ViewToggle view={view} />
          </div>
          {view === "table" ? <NovelTable novels={novels} />
            : view === "posters" ? <NovelPosters novels={novels} />
              : <ul className="space-y-3">{novels.map(n => <NovelRow key={n.id} novel={n} />)}</ul>}
        </>}
    </main>
  );
}
