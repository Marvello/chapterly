"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Settings2, X } from "lucide-react";
import type { TocEntry } from "@/lib/db";
import { go, runSync } from "@/lib/reader/client";
import { httpApi } from "@/lib/reader/httpApi";
import { idbStore } from "@/lib/reader/idb";
import { decide, savedFromLibrary, savedProgress } from "@/lib/reader/progress";
import { positionFromScroll } from "@/lib/reader/scroll";
import { THEMES, settingsStore, type ReaderSettings } from "@/lib/reader/settings";
import type { ReaderStore } from "@/lib/reader/sync";
import type { Position } from "@/lib/reader/types";

type Block = TocEntry & { html: string | null };   // html null = not downloaded
const MAX_BLOCKS = 5;                                // chapters kept in the DOM

async function loadBlock(store: ReaderStore, novelId: number, toc: TocEntry[], entry: TocEntry): Promise<Block> {
  const hit = await store.getChapter(entry.id);
  if (hit) return { ...entry, html: hit.html };
  if (navigator.onLine) {
    try {
      const i = toc.findIndex(c => c.id === entry.id);
      const [row] = await httpApi.chapters(novelId, i > 0 ? toc[i - 1].id : null, 1);
      if (row?.id === entry.id) {
        await store.putChapters([row]);
        return { ...entry, html: row.html };
      }
    } catch { /* falls through to the "not downloaded" stub */ }
  }
  return { ...entry, html: null };
}

export default function ReadingView({ novelId, chapterId }: { novelId: number; chapterId: number }) {
  const store = useMemo(() => idbStore(), []);
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
  const trimmed = useRef(0);
  const loading = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const updateSettings = (p: Partial<ReaderSettings>) => settingsStore.set({ ...settings, ...p });

  // We compensate for trimmed chapters ourselves; the browser's scroll anchoring would do it twice.
  useEffect(() => {
    const el = document.documentElement;
    el.style.overflowAnchor = "none";
    return () => { el.style.overflowAnchor = ""; };
  }, []);

  const openAt = useCallback(async (entry: TocEntry, list: TocEntry[], fraction = 0) => {
    restoreTo.current = { chapterId: entry.id, fraction };
    setBlocks([await loadBlock(store, novelId, list, entry)]);
    setChapterTitle(entry.title ?? `Chapter ${entry.idx}`);
  }, [novelId, store]);

  useEffect(() => {
    (async () => {
      let list = await store.getToc(novelId);
      if (!list && navigator.onLine) {
        try { list = await httpApi.toc(novelId); await store.setToc(novelId, list); } catch { /* handled below */ }
      }
      list ??= [];
      const novel = (await store.getLibrary())?.find(n => n.id === novelId);
      saved.current = savedProgress(novel ? savedFromLibrary(novel) : null, (await store.getOutbox(novelId)) ?? null);
      setToc(list);
      setNovelTitle(novel?.title ?? "");
      const entry = list.find(c => c.id === startId);
      if (entry) await openAt(entry, list, saved.current?.chapterId === entry.id ? saved.current.fraction : 0);
    })();
  }, [novelId, startId, store, openAt]);

  // After rendering: jump to a requested spot, or undo the jump caused by removing a chapter above.
  useLayoutEffect(() => {
    const r = restoreTo.current;
    if (r) {
      const el = root.current?.querySelector<HTMLElement>(`[data-chapter="${r.chapterId}"]`);
      if (el) {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + r.fraction * el.offsetHeight);
        restoreTo.current = null;
      }
    }
    if (trimmed.current) {
      window.scrollBy(0, -trimmed.current);
      trimmed.current = 0;
    }
  }, [blocks]);

  const appendNext = useCallback(async () => {
    const last = blocks.at(-1);
    if (loading.current || !last || last.html === null) return;   // stop after a not-downloaded stub
    const next = toc[toc.findIndex(c => c.id === last.id) + 1];
    if (!next) return;
    loading.current = true;
    const b = await loadBlock(store, novelId, toc, next);
    if (blocks.length >= MAX_BLOCKS) trimmed.current = root.current?.querySelector<HTMLElement>("[data-chapter]")?.offsetHeight ?? 0;
    setBlocks(prev => [...(prev.length >= MAX_BLOCKS ? prev.slice(1) : prev), b]);
    loading.current = false;
  }, [blocks, toc, store, novelId]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) appendNext(); }, { rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [appendNext]);

  // Back online: fill in stubs.
  useEffect(() => {
    const retry = async () => setBlocks(await Promise.all(blocks.map(b => (b.html === null ? loadBlock(store, novelId, toc, b) : b))));
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [blocks, toc, store, novelId]);

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
    if (entry) setChapterTitle(entry.title ?? `Chapter ${entry.idx}`);
    if (new URLSearchParams(window.location.search).get("chapter") !== String(cur.chapterId)) {
      window.history.replaceState(null, "", `/read?novel=${novelId}&chapter=${cur.chapterId}`);
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
    window.history.replaceState(null, "", `/read?novel=${novelId}&chapter=${entry.id}`);
  };

  const first = blocks[0];
  const prev = first ? toc[toc.findIndex(c => c.id === first.id) - 1] : undefined;
  const atEnd = !!blocks.at(-1) && toc.at(-1)?.id === blocks.at(-1)!.id;
  const theme = THEMES[settings.theme];

  return (
    <div style={{ ...theme, fontSize: settings.fontSize, lineHeight: settings.lineHeight }} className="min-h-screen">
      <header className={`fixed inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2 text-sm transition-transform ${barHidden ? "-translate-y-full" : ""}`}
        style={{ background: theme.background, borderBottom: "1px solid rgba(127,127,127,.25)" }}>
        <button onClick={() => go(`/read?novel=${novelId}`)} aria-label="Back to chapters"><ArrowLeft className="size-5" /></button>
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
            ← {prev.title ?? `Chapter ${prev.idx}`}
          </button>
        )}
        {blocks.map(b => (
          <article key={b.id} data-chapter={b.id} data-idx={b.idx} className="reader-content mb-16">
            {b.html === null
              ? <p className="opacity-70">{b.title ?? `Chapter ${b.idx}`}: not downloaded. Connect to load it.</p>
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
            <p>Your progress is at {toc.find(c => c.id === banner.chapterId)?.title ?? `Chapter ${banner.idx}`} ({Math.round(banner.fraction * 100)}%).</p>
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
