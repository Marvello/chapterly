import { AuthError, BadRequestError, type ReaderApi } from "./sync";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // A connection that is up but passes nothing (train, tunnel) would otherwise hang sync for minutes.
  const res = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new AuthError("signed out");
  if (res.status === 400) throw new BadRequestError(`${url}: ${await res.text()}`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const httpApi: ReaderApi = {
  library: () => req("/api/reader/library"),
  toc: id => req(`/api/reader/novels/${id}/toc`),
  chapters: (id, after, limit) =>
    req(`/api/reader/novels/${id}/chapters?${new URLSearchParams({ ...(after ? { after: String(after) } : {}), limit: String(limit) })}`),
  putProgress: e => req("/api/reader/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ novelId: e.novelId, chapterId: e.chapterId, fraction: e.fraction, readAt: e.readAt, force: e.force }),
  }),
};
