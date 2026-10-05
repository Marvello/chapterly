import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BookOpenText, Check, Clock, ExternalLink, Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import { checkNowAction, retryAction, setStatusAction } from "@/app/actions";
import AutoRefresh from "@/components/AutoRefresh";
import Cover from "@/components/Cover";
import DeleteButton from "@/components/DeleteButton";
import EpubToggle from "@/components/EpubToggle";
import Header from "@/components/Header";
import IntervalSelect from "@/components/IntervalSelect";
import SeriesStatusSelect from "@/components/SeriesStatusSelect";
import StatusBadge from "@/components/StatusBadge";
import { currentUserId } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { chapterLabel } from "@/lib/reader/label";
import { parseId } from "@/lib/validate";
import { displayTitle, isChecking, isSeriesDone, nextCheckAt, nextCheckLabel, novelStatus, relativeTime, workerDown } from "@/lib/view";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const btn = "flex items-center gap-1 rounded-lg border border-edge px-3 py-2 text-sm text-tprimary disabled:opacity-50";

export default async function NovelPage({ params, searchParams }:
  { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const id = parseId((await params).id);
  const db = getDb();
  const n = id ? db.getNovel(id) : undefined;
  if (!n) notFound();

  const uid = await currentUserId();
  const reading = uid ? db.readerLibrary(uid, n.id)[0] : undefined;
  const total = db.chapterCount(n.id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // ponytail: idx ≈ position (TOC order), so the progress page can be off by one for TOCs with gaps; exact needs a COUNT query.
  const progressPage = reading?.progress_idx != null ? Math.floor(reading.progress_idx / PAGE_SIZE) + 1 : 1;
  const page = Math.min(pages, parseId((await searchParams).page ?? "") ?? progressPage);
  const chapters = db.chapterPage(n.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const failing = db.failingChapters(n.id);
  const maxAttempts = Number(process.env.CHAPTERLY_MAX_ATTEMPTS || 5);
  const status = novelStatus(n);
  const [counts] = db.listNovels(undefined, n.id);
  const seenAt = db.workerSeenAt();
  const workerStopped = workerDown(seenAt, Number(process.env.CHAPTERLY_TICK_MIN || 1));
  const unread = reading?.progress_chapter_id != null ? reading.unread : null;
  const nextCheck = nextCheckAt(counts ?? n);
  const done = counts ? isSeriesDone(counts) : false;
  const idField = <input type="hidden" name="id" value={n.id} />;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <AutoRefresh active={status === "fetching_info" || status === "checking"} />
      <Header />

      {workerStopped && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-critical/50 bg-component p-3 text-sm text-critical">
          <AlertTriangle className="size-4 shrink-0" />
          Worker not running (last seen {relativeTime(seenAt)}): no checks or downloads until it&apos;s back.
        </p>
      )}

      <section className="mb-4 flex gap-4">
        <Cover url={n.cover_url} title={displayTitle(n)} className="h-36 w-24 shrink-0 rounded text-sm" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-tprimary">{displayTitle(n)}</h1>
            <StatusBadge status={status} />
          </div>
          {n.author && <p className="text-tmuted">{n.author}</p>}
          <p className="text-sm text-tmuted">{n.parser ?? "parser pending"} ·{" "}
            <a href={n.toc_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent">
              source <ExternalLink className="size-3" />
            </a>
          </p>
          <p className="text-sm text-tmuted">Checked {relativeTime(n.last_checked_at)}
            {n.status === "active" && !isChecking(n) && (done
              ? <> · no more checks — completed</>
              : nextCheck && <> · {nextCheckLabel(nextCheck)}{n.series_status === "dropped" && " (dropped: weekly at most)"}</>)}</p>
          {n.epub_path && <p className="break-all font-mono text-xs text-tmuted">{n.epub_path}</p>}
        </div>
      </section>

      <section className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`/?novel=${n.id}`} className={btn}>
          <BookOpenText className="size-4" /> Read{unread ? ` · ${unread} unread` : ""}
        </Link>
        {n.status === "active" && (
          <form action={checkNowAction}>{idField}
            <button className={btn} disabled={isChecking(n)}><RefreshCw className="size-4" /> Check now</button>
          </form>
        )}
        <form action={setStatusAction}>{idField}
          <input type="hidden" name="status" value={n.status === "paused" ? "active" : "paused"} />
          <button className={btn}>{n.status === "paused" ? <><Play className="size-4" /> Resume</> : <><Pause className="size-4" /> Pause</>}</button>
        </form>
        <IntervalSelect id={n.id} minutes={n.check_interval_min} />
        <SeriesStatusSelect id={n.id} status={n.series_status} manual={!!n.series_status_manual} />
        <EpubToggle id={n.id} on={!!n.epub_enabled} />
        <DeleteButton id={n.id} />
      </section>

      {(n.last_error || failing.length > 0) && (
        <section className="mb-6 rounded-xl border border-critical/50 bg-component p-4">
          <h2 className="mb-2 flex items-center gap-2 font-medium text-critical"><AlertTriangle className="size-4" /> Problems</h2>
          {n.last_error && <p className="mb-3 break-words text-sm text-tsecondary">{n.last_error}</p>}
          {failing.length > 0 && (
            <>
              <ul className="mb-3 space-y-1 text-sm">
                {failing.map(c => (
                  <li key={c.id} className="break-words">
                    <span className="text-tprimary">{c.title || c.url}</span>{" "}
                    <span className="text-tmuted">— {c.error} ({c.attempts}/{maxAttempts},{" "}
                      {c.attempts >= maxAttempts ? "gave up" : `retry ${relativeTime(c.retry_at)}`})</span>
                  </li>
                ))}
              </ul>
              <form action={retryAction}>{idField}
                <button className={btn}><RotateCcw className="size-4" /> Retry failed chapters</button>
              </form>
            </>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-medium text-tprimary">Chapters <span className="text-tmuted">({total})</span></h2>
        <ul className="divide-y divide-edge rounded-xl border border-edge bg-component">
          {chapters.map(c => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm" aria-current={c.id === reading?.progress_chapter_id || undefined}>
              <span className="w-12 shrink-0 text-right tabular-nums text-tmuted">{c.idx + 1}</span>
              <span className={`min-w-0 flex-1 truncate ${c.id === reading?.progress_chapter_id ? "text-accent" : "text-tsecondary"}`}>{chapterLabel(c)}</span>
              {c.fetched
                ? <span className="flex shrink-0 items-center gap-1 text-xs text-tmuted"><Check className="size-3 text-good" />{relativeTime(c.fetched_at)}</span>
                : c.error
                  ? <AlertTriangle role="img" className="size-4 shrink-0 text-critical" aria-label="failed" />
                  : <Clock role="img" className="size-4 shrink-0 text-tmuted" aria-label="pending" />}
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <nav className="mt-3 flex items-center justify-between text-sm">
            {page > 1 ? <Link href={`?page=${page - 1}`} className="text-accent">← Earlier</Link> : <span />}
            <span className="text-tmuted">Page {page} of {pages}</span>
            {page < pages ? <Link href={`?page=${page + 1}`} className="text-accent">Later →</Link> : <span />}
          </nav>
        )}
      </section>
    </main>
  );
}
