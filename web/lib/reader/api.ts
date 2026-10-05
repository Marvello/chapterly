// Reader API logic, kept free of Next/auth so it's unit-tested; app/api/reader/* are thin wrappers.
import type { Db, ProgressInput } from "@/lib/db";
import { parseId } from "@/lib/validate";

export type ReaderDb = Pick<Db, "getNovel" | "readerLibrary" | "readerToc" | "readerChapters" | "saveCleanHtml" | "saveProgress">;
export type ApiResult = { status: number; body: unknown };

const err = (status: number, error: string): ApiResult => ({ status, body: { error } });
export const json = (r: ApiResult) => Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });

function novelId(db: ReaderDb, raw: string): number | null {
  const id = parseId(raw);
  return id && db.getNovel(id) ? id : null;
}

export function toc(db: ReaderDb, rawId: string): ApiResult {
  const id = novelId(db, rawId);
  return id ? { status: 200, body: db.readerToc(id) } : err(404, "not found");
}

/** Chapters after `?after=<chapterId>` (default from the start), `?limit=` 1..200 (default 50). */
export function chapters(db: ReaderDb, sanitize: (html: string) => string, rawId: string, params: URLSearchParams,
  log: (msg: string) => void = console.error): ApiResult {
  const id = novelId(db, rawId);
  if (!id) return err(404, "not found");
  const afterRaw = params.get("after");
  const after = afterRaw === null ? null : parseId(afterRaw);
  if (afterRaw !== null && !after) return err(400, "bad after");
  const limitRaw = params.get("limit") ?? "50";
  if (!/^\d{1,4}$/.test(limitRaw) || Number(limitRaw) < 1) return err(400, "bad limit");
  const out = [];
  for (const r of db.readerChapters(id, after, Math.min(Number(limitRaw), 200))) {
    let html = r.html;
    if (!r.html_clean) {
      // Stored before the worker sanitized chapters: clean it once, now.
      try {
        html = sanitize(r.html);
        db.saveCleanHtml(r.id, html);
      } catch (e) {
        log(`reader: sanitizing chapter ${r.id} failed: ${(e as Error).message}`);
        continue;
      }
    }
    out.push({ id: r.id, novelId: r.novel_id, idx: r.idx, title: r.title, html });
  }
  return { status: 200, body: out };
}

export function parseProgress(text: string, now = Date.now()): ProgressInput | null {
  let b: unknown;
  try { b = JSON.parse(text); } catch { return null; }
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const novelId = parseId(String(o.novelId)), chapterId = parseId(String(o.chapterId));
  const fraction = typeof o.fraction === "number" ? o.fraction : NaN;
  const readAt = typeof o.readAt === "string" ? Date.parse(o.readAt) : NaN;
  if (!novelId || !chapterId || !Number.isFinite(fraction) || Number.isNaN(readAt) || readAt > now + 5 * 60_000) return null;
  if (o.force !== undefined && typeof o.force !== "boolean") return null;
  return { novelId, chapterId, fraction: Math.min(1, Math.max(0, fraction)), readAt: new Date(readAt).toISOString(), force: o.force === true };
}

/** security.md CSRF: JSON content type + same Origin as the app, else 403. */
export function putProgress(db: ReaderDb, userId: number, headers: Headers, text: string, appOrigin: string,
  now = Date.now()): ApiResult {
  if (!(headers.get("content-type") ?? "").startsWith("application/json") || headers.get("origin") !== appOrigin) {
    return err(403, "forbidden");
  }
  const p = parseProgress(text, now);
  if (!p) return err(400, "bad progress");
  try {
    return { status: 200, body: db.saveProgress(userId, p) };
  } catch (e) {
    return err(400, (e as Error).message);
  }
}
