// Typed bridge to ../src/db.js — the ONLY module with SQL, shared with the worker.
// Loaded at runtime from NOVEL_ROOT (not bundled): it uses node:sqlite and reads db/migrations/*.sql.
import { createRequire } from "node:module";
import path from "node:path";

export interface NovelRow {
  id: number; toc_url: string; parser: string | null; title: string | null; author: string | null;
  language: string | null; subjects: string | null; description: string | null; cover_url: string | null;
  status: "active" | "paused" | "completed"; check_interval_min: number;
  last_checked_at: string | null; last_success_at: string | null; last_error: string | null;
  epub_path: string | null; epub_built_at: string | null; created_at: string;
  check_requested_at: string | null; check_finished_at: string | null;
}
export interface LibraryRow extends NovelRow {
  chapters_total: number; chapters_fetched: number; chapters_failing: number; chapters_new: number;
}
export interface ChapterRow {
  id: number; idx: number; url: string; title: string | null; fetched_at: string | null;
  error: string | null; attempts: number; retry_at: string | null; fetched: 0 | 1;
}
export interface UserRow {
  id: number; name: string | null; email: string; password_hash: string; failed_logins: number;
  locked_until: string | null; session_version: number; oidc_sub: string | null; created_at: string;
}
export interface Db {
  addNovel(url: string): NovelRow;
  findNovelByUrl(url: string): NovelRow | undefined;
  getNovel(id: number): NovelRow | undefined;
  listNovels(newSince?: string): LibraryRow[];
  requestCheck(id: number): void;
  setCheckInterval(id: number, minutes: number): void;
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
}

const cache = globalThis as unknown as { __novelDb?: Db };

export function getDb(): Db {
  if (!cache.__novelDb) {
    const root = path.resolve(process.env.NOVEL_ROOT || path.join(process.cwd(), ".."));
    const req = createRequire(path.join(root, "package.json"));
    const mod = req(path.join(root, "src", "db.js")) as { openDb: () => Db };
    cache.__novelDb = mod.openDb(); // runs pending migrations (under the write lock)
  }
  return cache.__novelDb;
}
