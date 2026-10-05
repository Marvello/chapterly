"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, CloudOff, Download, Settings2 } from "lucide-react";
import type { ReaderNovel, TocEntry } from "@/lib/db";
import { go, runSync } from "@/lib/reader/client";
import { httpApi } from "@/lib/reader/httpApi";
import { idbStore } from "@/lib/reader/idb";
import { online } from "@/lib/reader/online";
import { chapterState, savedFromLibrary, savedProgress } from "@/lib/reader/progress";
import type { Position } from "@/lib/reader/types";

type State = { novel?: ReaderNovel; toc: TocEntry[]; cached: Set<number>; saved: Position | null; pinned: boolean };

async function readState(novelId: number): Promise<State> {
  const store = idbStore();
  const novel = (await store.getLibrary())?.find(n => n.id === novelId);
  let toc = await store.getToc(novelId);
  if (!toc && navigator.onLine) {
    try { toc = await httpApi.toc(novelId); await store.setToc(novelId, toc); } catch { /* shown as "connect once" */ }
  }
  const saved = savedProgress(novel ? savedFromLibrary(novel) : null, (await store.getOutbox(novelId)) ?? null);
  return { novel, toc: toc ?? [], cached: await store.cachedChapterIds(novelId), saved, pinned: (await store.pins()).has(novelId) };
}

export default function NovelView({ novelId, rev }: { novelId: number; rev: number }) {
  const [state, setState] = useState<State | null>(null);
  const current = useRef<HTMLLIElement>(null);
  const isOnline = useSyncExternalStore(online.subscribe, online.get, online.getServer);

  const load = useCallback(async () => setState(await readState(novelId)), [novelId]);

  useEffect(() => {
    let live = true;
    readState(novelId).then(s => { if (live) setState(s); });
    return () => { live = false; };
  }, [novelId, rev]);
  useEffect(() => { current.current?.scrollIntoView({ block: "center" }); }, [state?.saved?.chapterId]);

  if (!state) return null;
  const { novel, toc, cached, saved, pinned } = state;
  const start = saved?.chapterId ?? toc[0]?.id;

  const togglePin = async () => {
    await idbStore().setPin(novelId, !pinned);
    await load();
    if (navigator.onLine) runSync().then(load).catch(() => {});
  };

  return (
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-4 flex items-center gap-2">
        <button onClick={() => go("/")} aria-label="Back" className="text-tmuted hover:text-tprimary"><ArrowLeft className="size-5" /></button>
        <h1 className="truncate text-lg font-semibold text-tprimary">{novel?.title ?? "Novel"}</h1>
      </header>
      <div className="mb-4 flex flex-wrap gap-2">
        {start && (
          <button onClick={() => go(`/?novel=${novelId}&chapter=${start}`)}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-page">{saved ? "Continue" : "Start reading"}</button>
        )}
        <button onClick={togglePin} aria-pressed={pinned}
          className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-sm ${pinned ? "border-accent text-accent" : "border-edge text-tprimary"}`}>
          <Download className="size-4" /> Download unread
        </button>
        {/* Check now, pause, interval, EPUB, delete: server-rendered, so online only. */}
        {isOnline && (
          <Link href={`/novels/${novelId}`} className="flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-tprimary">
            <Settings2 className="size-4" /> Manage
          </Link>
        )}
      </div>
      {toc.length === 0
        ? <p className="text-tmuted">This novel isn&apos;t on the phone yet. Connect once to load it.</p>
        : (
          <ol className="divide-y divide-edge rounded-xl border border-edge bg-component">
            {toc.map(c => {
              const s = chapterState(c, saved);
              return (
                <li key={c.id} ref={c.id === saved?.chapterId ? current : undefined}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}>
                  <button onClick={() => go(`/?novel=${novelId}&chapter=${c.id}`)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm ${
                      s === "read" ? "text-tmuted" : s === "current" ? "text-accent" : "font-medium text-tprimary"}`}>
                    <span className="truncate">{c.title ?? `Chapter ${c.idx}`}</span>
                    {!cached.has(c.id) && <CloudOff className="size-3.5 shrink-0 text-tmuted" aria-label="Not downloaded" />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
    </main>
  );
}
