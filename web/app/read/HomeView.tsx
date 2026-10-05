"use client";
/* eslint-disable @next/next/no-img-element -- covers are remote images from the novel's site */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReaderNovel } from "@/lib/db";
import { go } from "@/lib/reader/client";
import { idbStore } from "@/lib/reader/idb";
import { sortReaderLibrary } from "@/lib/reader/progress";

type Row = { novel: ReaderNovel; cached: number; pinned: boolean };

export default function HomeView({ rev, notice }: { rev: number; notice: string | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const store = idbStore();
      const pins = await store.pins();
      const out: Row[] = [];
      for (const n of sortReaderLibrary((await store.getLibrary()) ?? [])) {
        out.push({ novel: n, cached: (await store.cachedChapterIds(n.id)).size, pinned: pins.has(n.id) });
      }
      if (live) setRows(out);
    })();
    return () => { live = false; };
  }, [rev]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-tprimary">Reading</h1>
        <Link href="/" className="text-sm text-tmuted hover:text-tprimary">Manage</Link>
      </header>
      {notice && <p className="mb-3 rounded-lg border border-warn px-3 py-2 text-sm text-warn">{notice}</p>}
      {rows && rows.length === 0 && <p className="text-tmuted">Nothing here yet. Open the reader once while online.</p>}
      <ul className="space-y-2">
        {rows?.map(({ novel: n, cached, pinned }) => (
          <li key={n.id}>
            <button onClick={() => go(`/read?novel=${n.id}`)}
              className="flex w-full gap-3 rounded-xl border border-edge bg-component p-3 text-left hover:border-accent">
              {n.cover_url
                ? <img src={n.cover_url} alt="" className="h-16 w-11 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
                : <div className="h-16 w-11 shrink-0 rounded bg-edge" />}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium text-tprimary">{n.title ?? n.toc_url}</h2>
                {n.author && <p className="truncate text-sm text-tmuted">{n.author}</p>}
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-tmuted">
                  {n.progress_chapter_id !== null && n.unread > 0 &&
                    <span className="rounded bg-accent px-1.5 font-medium text-page">{n.unread} unread</span>}
                  <span>{pinned && cached >= n.unread ? "all unread offline" : `${cached} offline`}</span>
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
