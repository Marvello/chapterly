import AddNovelForm from "@/components/AddNovelForm";
import AutoRefresh from "@/components/AutoRefresh";
import Header from "@/components/Header";
import NovelRow from "@/components/NovelRow";
import { getDb } from "@/lib/db";
import { newSince, novelStatus, sortLibrary } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const novels = sortLibrary(getDb().listNovels(newSince()));
  // Only while the worker is actually on it; gave-up chapters leave fetched < total forever.
  const live = novels.some(n => ["fetching_info", "checking"].includes(novelStatus(n)));
  return (
    <main className="mx-auto max-w-3xl p-4">
      <AutoRefresh active={live} />
      <Header />
      <AddNovelForm />
      {novels.length === 0
        ? <p className="text-tmuted">No novels yet. Paste a novel&apos;s table-of-contents URL above.</p>
        : <ul className="space-y-3">{novels.map(n => <NovelRow key={n.id} novel={n} />)}</ul>}
    </main>
  );
}
