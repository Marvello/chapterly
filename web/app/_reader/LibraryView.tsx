"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import AddNovelForm from "@/components/AddNovelForm";
import Header from "@/components/Header";
import LibraryControls from "@/components/LibraryControls";
import NovelPosters from "@/components/NovelPosters";
import NovelRow from "@/components/NovelRow";
import NovelTable from "@/components/NovelTable";
import ViewToggle from "@/components/ViewToggle";
import type { LibraryNovel } from "@/lib/db";
import { idbStore } from "@/lib/reader/idb";
import { online } from "@/lib/reader/online";
import { viewPref } from "@/lib/reader/viewPref";
import { novelStatus, parseLibraryQuery, queryLibrary } from "@/lib/view";

/** The library, from the phone's cached copy. Offline it hides what needs the server (adding, sign-out,
 * check status, management links). `resync` asks the app for a fresh sync (after adding, while checking). */
export default function LibraryView({ rev, notice, resync }: { rev: number; notice: string | null; resync: () => void }) {
  const [all, setAll] = useState<LibraryNovel[] | null>(null);
  const params = useSearchParams();
  const view = useSyncExternalStore(viewPref.subscribe, viewPref.get, viewPref.getServer);
  const isOnline = useSyncExternalStore(online.subscribe, online.get, online.getServer);

  useEffect(() => {
    let live = true;
    // The API returns full library rows; the store is typed with the reader's subset of them.
    idbStore().getLibrary().then(l => { if (live) setAll((l ?? []) as LibraryNovel[]); });
    return () => { live = false; };
  }, [rev]);

  // While the worker is fetching something, refresh every 10 s (was AutoRefresh on the server page).
  const busy = !!all?.some(n => ["fetching_info", "checking"].includes(novelStatus(n)));
  useEffect(() => {
    if (!busy || !isOnline) return;
    const t = setInterval(resync, 10_000);
    return () => clearInterval(t);
  }, [busy, isOnline, resync]);

  const query = parseLibraryQuery(Object.fromEntries(params));
  const novels = all ? queryLibrary(all, query) : [];

  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 border-b border-edge bg-page px-4 pt-4">
        <Header signOut={isOnline} />
        {isOnline
          ? <AddNovelForm onAdded={resync} />
          : <p className="mb-4 text-sm text-tmuted">Offline: showing the novels saved on this device.</p>}
      </div>
      {notice && <p className="mb-3 rounded-lg border border-warn px-3 py-2 text-sm text-warn">{notice}</p>}
      {all === null ? null : all.length === 0
        ? <p className="text-tmuted">{isOnline ? "No novels yet. Paste a novel's table-of-contents URL above." : "Nothing saved on this device yet. Connect once to load your library."}</p>
        : <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1"><LibraryControls query={query} /></div>
            <ViewToggle />
          </div>
          <p className="mb-3 text-sm text-tmuted">
            {novels.length === all.length ? `${all.length} novel${all.length === 1 ? "" : "s"}` : `${novels.length} of ${all.length} novels`}
          </p>
          {novels.length === 0 ? <p className="text-tmuted">No novels match.</p>
            : view === "table" ? <NovelTable novels={novels} online={isOnline} />
              : view === "posters" ? <NovelPosters novels={novels} online={isOnline} />
                : <ul className="space-y-3">{novels.map(n => <NovelRow key={n.id} novel={n} online={isOnline} />)}</ul>}
        </>}
    </main>
  );
}
