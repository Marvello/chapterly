// Input validation at the server-action boundary (common-tech security.md #13).
export const INTERVALS = [
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
  { minutes: 1440, label: "Daily" },
  { minutes: 4320, label: "Every 3 days" },
  { minutes: 10080, label: "Weekly" },
] as const;

export function parseNovelUrl(input: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const s = typeof input === "string" ? input.trim() : "";
  if (!s) return { ok: false, error: "Paste the novel's page URL." };
  if (s.length > 2048) return { ok: false, error: "That URL is too long." };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: "That doesn't look like a URL." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "Only http(s) URLs are supported." };
  u.hash = u.username = u.password = ""; // no stored credentials; #fragment variants aren't a different novel
  return { ok: true, url: u.href };
}

export function parseInterval(input: unknown): number | null {
  const n = Number(input);
  return INTERVALS.some(i => i.minutes === n) ? n : null;
}

export function parseId(input: unknown): number | null {
  return typeof input === "string" && /^[1-9]\d{0,9}$/.test(input) ? Number(input) : null;
}

/**
 * Only sites with a dedicated WebToEpub parser can be scraped (the worker publishes the hostnames on startup).
 * Returns an error message, or null when supported. No list yet (lookup → null) is an error too: the worker
 * fetches a URL before it can tell it has no parser, so unchecked adds would let anyone make it fetch anything.
 */
export function checkSupportedSite(url: string, isSupportedHost: (host: string) => boolean | null): string | null {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const ok = isSupportedHost(host);
  if (ok === null) return "The worker hasn't started yet (no supported-site list). Try again in a minute.";
  return ok ? null : `${host} isn't a supported site (no WebToEpub parser).`;
}

/** Request body as text, or null once it passes `max` bytes (stops reading there: no unbounded buffering). */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length")) > max) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of req.body ?? []) {
    if ((size += c.byteLength) > max) return null; // leaving the loop cancels the stream
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const SERIES_STATUSES = [
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number]["value"];

export function parseSeriesStatus(input: unknown): SeriesStatus | null {
  return SERIES_STATUSES.find(s => s.value === input)?.value ?? null;
}
