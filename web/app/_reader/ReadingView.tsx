"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { TocEntry } from "@/lib/db";
import { appendBlock } from "@/lib/reader/blocks";
import { go, runSync } from "@/lib/reader/client";
import { fetchChapter } from "@/lib/reader/fetchChapter";
import { httpApi } from "@/lib/reader/httpApi";
import { idbStore } from "@/lib/reader/idb";
import { chapterLabel } from "@/lib/reader/label";
import { decide, savedFromLibrary, savedProgress } from "@/lib/reader/progress";
import { positionFromScroll } from "@/lib/reader/scroll";
import { THEMES, settingsStore, type ReaderSettings } from "@/lib/reader/settings";
import { AuthError, type ReaderStore } from "@/lib/reader/sync";
import type { Position } from "@/lib/reader/types";

type Block = TocEntry & { html: string | null };   // html null = not downloaded
const MAX_BLOCKS = 5;                                // chapters kept in the DOM

/** The chapter (phone copy, else server); a stub when unreachable. AuthError propagates. */
async function loadBlock(store: ReaderStore, novelId: number, toc: TocEntry[], entry: TocEntry) {
  try {
    const r = await fetchChapter(httpApi, store, novelId, toc, entry.id);
    return { block: { ...entry, html: r.chapter?.html ?? null } as Block, toc: r.toc };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return { block: { ...entry, html: null } as Block, toc };
  }
}

export default function ReadingView({ novelId, chapterId }: { novelId: number; chapterId: number }) {
  const store = useMemo(() => idbStore(), []);
  const router = useRouter();
  const [startId] = useState(chapterId);   // later URL updates come from our own replaceState
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [novelTitle, setNovelTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [banner, setBanner] = useState<Position | null>(null);
  const [barHidden, setBarHidden] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.getServer);
  const saved = useRef<Position | null>(null);
  const dismissed = useRef(false);
  const restoreTo = useRef<{ chapterId: number; fraction: number } | null>(null);
  const anchor = useRef<{ id: number; top: number } | null>(null);   // chapter to hold still across a re-render
  const gen = useRef(0);                                               // bumped by every jump; stale loads are dropped
  const opened = useRef(false);                                        // the initial open runs once (deps change with the URL)
  const loading = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const updateSettings = (p: Partial<ReaderSettings>) => settingsStore.set({ ...settings, ...p });
  const onLoadError = useCallback((e: unknown) => { if (e instanceof AuthError) router.replace("/login"); }, [router]);

  // We hold the reading spot ourselves (anchor below); the browser's scroll anchoring would do it twice.
  useEffect(() => {
    const el = document.documentElement;
    el.style.overflowAnchor = "none";
    return () => { el.style.overflowAnchor = ""; };
  }, []);

  const openAt = useCallback(async (entry: TocEntry, list: TocEntry[], fraction = 0) => {
    const g = ++gen.current;
    try {
      const { block, toc: fresh } = await loadBlock(store, novelId, list, entry);
      if (g !== gen.current) return;   // another jump happened meanwhile
      if (fresh !== list) setToc(fresh);
      restoreTo.current = { chapterId: entry.id, fraction };
      setBlocks([block]);
      setChapterTitle(chapterLabel(entry));
    } catch (e) {
      onLoadError(e);
    }
  }, [novelId, store, onLoadError]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    (async () => {
      let list = await store.getToc(novelId);
      if (!list && navigator.onLine) {
        try { list = await httpApi.toc(novelId); await store.setToc(novelId, list); } catch (e) { onLoadError(e); }
      }
      list ??= [];
      const novel = (await store.getLibrary())?.find(n => n.id === novelId);
      saved.current = savedProgress(novel ? savedFromLibrary(novel) : null, (await store.getOutbox(novelId)) ?? null);
      setToc(list);
      setNovelTitle(novel?.title ?? "");
      const entry = list.find(c => c.id === startId);
      if (entry) await openAt(entry, list, saved.current?.chapterId === entry.id ? saved.current.fraction : 0);
    })();
  }, [novelId, startId, store, openAt, onLoadError]);

  const topVisibleChapter = () => {
    const el = [...(root.current?.querySelectorAll<HTMLElement>("[data-chapter]") ?? [])]
      .find(e => e.getBoundingClientRect().bottom > 0);
    return el ? { id: Number(el.dataset.chapter), top: el.getBoundingClientRect().top } : null;
  };

  // After rendering: jump to a requested spot, or keep the chapter being read where it was on screen
  // (a chapter trimmed above would otherwise shift the text by its height plus margin).
  useLayoutEffect(() => {
    const r = restoreTo.current;
    if (r) {
      const el = root.current?.querySelector<HTMLElement>(`[data-chapter="${r.chapterId}"]`);
      if (el) {
        // below the fixed top bar, not under it
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + r.fraction * el.offsetHeight
          - (header.current?.offsetHeight ?? 0));
        restoreTo.current = null;
      }
    }
    const a = anchor.current;
    if (a) {
      anchor.current = null;
      const el = root.current?.querySelector<HTMLElement>(`[data-chapter="${a.id}"]`);
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
    }
  }, [blocks]);

  const appendNext = useCallback(async () => {
    const last = blocks.at(-1);
    if (loading.current || !last || last.html === null) return;   // stop after a not-downloaded stub
    const next = toc[toc.findIndex(c => c.id === last.id) + 1];
    if (!next) return;
    loading.current = true;
    const g = gen.current;
    try {
      const { block, toc: fresh } = await loadBlock(store, novelId, toc, next);
      if (g !== gen.current) return;
      if (fresh !== toc) setToc(fresh);
      anchor.current = topVisibleChapter();
      setBlocks(prev => appendBlock(prev, last.id, block, MAX_BLOCKS));
    } catch (e) {
      onLoadError(e);
    } finally {
      loading.current = false;
    }
  }, [blocks, toc, store, novelId, onLoadError]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendNext(); }, { rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [appendNext]);

  // Back online: fill in stubs (in place, so a chapter appended meanwhile isn't overwritten).
  useEffect(() => {
    const retry = async () => {
      for (const b of blocks.filter(x => x.html === null)) {
        try {
          const { block } = await loadBlock(store, novelId, toc, b);
          if (block.html !== null) setBlocks(prev => prev.map(x => (x.id === block.id ? block : x)));
        } catch (e) {
          onLoadError(e);
        }
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [blocks, toc, store, novelId, onLoadError]);

  const currentPosition = useCallback((): Position | null => {
    const els = root.current?.querySelectorAll<HTMLElement>("[data-chapter]");
    if (!els?.length) return null;
    const pos = positionFromScroll([...els].map(el => ({ chapterId: Number(el.dataset.chapter), idx: Number(el.dataset.idx),
      top: el.getBoundingClientRect().top + window.scrollY, height: el.offsetHeight })), window.scrollY);
    return pos && { novelId, ...pos };
  }, [novelId]);

  const track = useCallback(async () => {
    const cur = currentPosition();
    if (!cur) return;
    const entry = toc.find(c => c.id === cur.chapterId);
    if (entry) setChapterTitle(chapterLabel(entry));
    if (new URLSearchParams(window.location.search).get("chapter") !== String(cur.chapterId)) {
      window.history.replaceState(null, "", `/?novel=${novelId}&chapter=${cur.chapterId}`);
    }
    const d = decide(cur, saved.current);
    if (d === "save") {
      saved.current = cur;
      setBanner(null);
      await store.queue({ ...cur, readAt: new Date().toISOString(), force: false });
    } else if (d === "behind" && !dismissed.current) {
      setBanner(saved.current);
    }
  }, [currentPosition, toc, novelId, store]);

  useEffect(() => {
    const t = setInterval(track, 5000);
    const onHide = async () => {
      if (document.visibilityState !== "hidden") return;
      await track();
      if (navigator.onLine) runSync({ flushOnly: true }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onHide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onHide); };
  }, [track]);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => { const y = window.scrollY; setBarHidden(y > last && y > 80); last = y; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const setProgressHere = async () => {
    const cur = currentPosition();
    if (!cur) return;
    saved.current = cur;
    setBanner(null);
    await store.queue({ ...cur, readAt: new Date().toISOString(), force: true });
    if (navigator.onLine) runSync({ flushOnly: true }).catch(() => {});
  };
  const goToSaved = async () => {
    const s = saved.current, entry = toc.find(c => c.id === s?.chapterId);
    if (!s || !entry) return;
    setBanner(null);
    await openAt(entry, toc, s.fraction);
    window.history.replaceState(null, "", `/?novel=${novelId}&chapter=${entry.id}`);
  };

  const first = blocks[0];
  const prev = first ? toc[toc.findIndex(c => c.id === first.id) - 1] : undefined;
  const atEnd = !!blocks.at(-1) && toc.at(-1)?.id === blocks.at(-1)!.id;
  const theme = THEMES[settings.theme];

  return (
    <div style={{ ...theme, fontSize: settings.fontSize, lineHeight: settings.lineHeight }} className="min-h-screen">
      <header ref={header} className={`fixed inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2 text-sm transition-transform ${barHidden ? "-translate-y-full" : ""}`}
        style={{ background: theme.background, borderBottom: "1px solid rgba(127,127,127,.25)" }}>
        <button onClick={() => go(`/?novel=${novelId}`)} aria-label="Back to chapters"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-medium">{novelTitle}</p>
          <p className="truncate opacity-70">{chapterTitle}</p>
        </div>
        <button onClick={() => setShowSettings(v => !v)} aria-label="Reading settings"><Settings2 className="size-5" /></button>
      </header>

      {showSettings && (
        <div className="fixed right-2 top-14 z-20 w-64 space-y-3 rounded-xl p-3 text-sm shadow-lg"
          style={{ background: theme.background, border: "1px solid rgba(127,127,127,.35)" }}>
          <div className="flex items-center justify-between">Text size
            <span className="flex gap-2">
              <button className="rounded border px-2" onClick={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 2) })}>A−</button>
              <button className="rounded border px-2" onClick={() => updateSettings({ fontSize: Math.min(28, settings.fontSize + 2) })}>A+</button>
            </span>
          </div>
          <div className="flex items-center justify-between">Line spacing
            <span className="flex gap-2">
              <button className="rounded border px-2" onClick={() => updateSettings({ lineHeight: Math.max(1.3, +(settings.lineHeight - 0.1).toFixed(1)) })}>−</button>
              <button className="rounded border px-2" onClick={() => updateSettings({ lineHeight: Math.min(2.2, +(settings.lineHeight + 0.1).toFixed(1)) })}>+</button>
            </span>
          </div>
          <div className="flex gap-2">
            {(Object.keys(THEMES) as ReaderSettings["theme"][]).map(t => (
              <button key={t} onClick={() => updateSettings({ theme: t })} aria-pressed={settings.theme === t}
                className={`flex-1 rounded border px-2 py-1 capitalize ${settings.theme === t ? "font-semibold" : "opacity-70"}`}
                style={THEMES[t]}>{t}</button>
            ))}
          </div>
        </div>
      )}

      <div ref={root} className="mx-auto max-w-2xl px-5 pb-24 pt-20">
        {toc.length === 0 && <p className="opacity-70">This novel isn&apos;t on the phone yet. Connect once to load it.</p>}
        {prev && (
          <button onClick={() => openAt(prev, toc)} className="mb-8 block text-sm opacity-70 underline">
            ← {chapterLabel(prev)}
          </button>
        )}
        {blocks.map(b => (
          <article key={b.id} data-chapter={b.id} data-idx={b.idx} className="reader-content mb-16">
            {b.html === null
              ? <p className="opacity-70">{chapterLabel(b)}: not downloaded. Connect to load it.</p>
              : <div dangerouslySetInnerHTML={{ __html: b.html }} />}
          </article>
        ))}
        <div ref={sentinel} className="h-px" />
        {atEnd && <p className="py-8 text-center text-sm opacity-60">You&apos;re caught up.</p>}
      </div>

      {banner && (
        <div className="fixed inset-x-2 bottom-3 z-20 mx-auto max-w-xl rounded-xl p-3 text-sm shadow-lg"
          style={{ background: theme.background, border: "1px solid rgba(127,127,127,.35)" }} role="status">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p>Your progress is at {chapterLabel(toc.find(c => c.id === banner.chapterId) ?? banner)} ({Math.round(banner.fraction * 100)}%).</p>
            <button onClick={() => { dismissed.current = true; setBanner(null); }} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
          <div className="flex gap-2">
            <button onClick={setProgressHere} className="flex-1 rounded-lg border px-3 py-1.5">Set progress here</button>
            <button onClick={goToSaved} className="flex-1 rounded-lg border px-3 py-1.5 font-medium">Go to it</button>
          </div>
        </div>
      )}
    </div>
  );
}
