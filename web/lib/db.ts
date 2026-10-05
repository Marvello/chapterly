// Typed bridge to ../shared/db.js — the ONLY module with SQL, shared with the worker.
// Loaded at runtime from CHAPTERLY_SHARED_DIR (not bundled): it uses node:sqlite and reads migrations/*.sql.
import { createRequire } from "node:module";
import path from "node:path";

export interface NovelRow {
  id: number; toc_url: string; parser: string | null; title: string | null; author: string | null;
  language: string | null; subjects: string | null; description: string | null; cover_url: string | null;
  status: "active" | "paused" | "completed"; check_interval_min: number;
  last_checked_at: string | null; last_success_at: string | null; last_error: string | null;
  epub_path: string | null; epub_built_at: string | null; created_at: string;
  check_requested_at: string | null; check_finished_at: string | null;
  series_status: "ongoing" | "completed" | "dropped"; series_status_manual: 0 | 1;
  check_failures: number; check_retry_at: string | null;
  epub_enabled: 0 | 1;
}
export interface LibraryRow extends NovelRow {
  chapters_total: number; chapters_fetched: number; chapters_failing: number; chapters_new: number;
  last_fetched_at: string | null; next_retry_at: string | null;
  unread?: number | null; // filled in by the library page from readerLibrary (null = not started)
}
export interface ChapterRow {
  id: number; idx: number; url: string; title: string | null; fetched_at: string | null;
  error: string | null; attempts: number; retry_at: string | null; fetched: 0 | 1;
}
export interface UserRow {
  id: number; name: string | null; email: string; password_hash: string; failed_logins: number;
  locked_until: string | null; session_version: number; oidc_sub: string | null; created_at: string;
}
export interface ReaderPosition { novelId: number; chapterId: number; idx: number; fraction: number; readAt: string }
export interface TocEntry { id: number; idx: number; title: string | null }
export interface ReaderChapterRow extends TocEntry { novel_id: number; html: string; html_clean: number }   // CLEAN_VERSION it was cleaned with; 0 = never
export interface ReaderNovel {
  id: number; title: string | null; author: string | null; cover_url: string | null; toc_url: string;
  chapters_fetched: number; unread: number | null; // null in /api/reader/library until the novel is started
  progress_chapter_id: number | null; progress_idx: number | null; progress_fraction: number | null; read_at: string | null;
}
/** One row of the merged library (the phone caches these): management fields + reading progress. */
export type LibraryNovel = Omit<LibraryRow, "unread"> & ReaderNovel;
export interface ProgressInput { novelId: number; chapterId: number; fraction: number; readAt: string; force: boolean }
export interface Db {
  addNovel(url: string): NovelRow;
  findNovelByUrl(url: string): NovelRow | undefined;
  getNovel(id: number): NovelRow | undefined;
  listNovels(newSince?: string, novelId?: number): LibraryRow[];
  requestCheck(id: number): void;
  setCheckInterval(id: number, minutes: number): void;
  setSeriesStatus(id: number, status: "ongoing" | "completed" | "dropped"): void;
  setStatus(id: number, status: "active" | "paused"): void;
  deleteNovel(id: number): void;
  resetChapterRetries(novelId: number): void;
  chapterPage(novelId: number, limit: number, offset: number): ChapterRow[];
  chapterCount(novelId: number): number;
  failingChapters(novelId: number): ChapterRow[];
  getUserByEmail(email: string): UserRow | undefined;
  getUserById(id: number): UserRow | undefined;
  getUserByOidcSub(sub: string): UserRow | undefined;
  recordLoginFailure(id: number, lockedUntil: string | null): void;
  recordLoginSuccess(id: number): void;
  bindOidcSub(id: number, sub: string): number;
  isSupportedHost(host: string): boolean | null;
  readerLibrary(userId: number, novelId?: number): ReaderNovel[];
  readerToc(novelId: number): TocEntry[];
  readerChapters(novelId: number, afterChapterId: number | null, limit: number): ReaderChapterRow[];
  saveCleanHtml(chapterId: number, html: string, cleanVersion: number): void;
  getProgress(userId: number, novelId: number): ReaderPosition | null;
  saveProgress(userId: number, p: ProgressInput): { saved: boolean; position: ReaderPosition | null };
  setEpubEnabled(id: number, on: boolean): void;
  workerSeenAt(): string | null;   // worker_status.seen_at: last worker heartbeat
}

const cache = globalThis as unknown as { __novelDb?: Db };

export function getDb(): Db {
  if (!cache.__novelDb) {
    const dir = path.resolve(process.env.CHAPTERLY_SHARED_DIR || path.join(process.cwd(), "..", "shared"));
    const req = createRequire(path.join(dir, "package.json"));
    const mod = req(path.join(dir, "db.js")) as { openDb: () => Db };
    cache.__novelDb = mod.openDb(); // runs pending migrations (under the write lock)
  }
  return cache.__novelDb;
}
