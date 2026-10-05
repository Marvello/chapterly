// Copy of worker/src/clean.js (common-tech "copy, don't depend"): every rule applied to chapter HTML.
// Change a rule there and here together, and bump CLEAN_VERSION (lib/cleanVersion.ts) — the parity test checks both.
// Used by the reader API to re-clean chapters stored with an older CLEAN_VERSION.
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

export { CLEAN_VERSION } from "./cleanVersion";

const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

// Sites like freewebnovel repeat the chapter title as an <h2> right under WebToEpub's <h1>.
const LEAD = /^(\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*)<h2\b[^>]*>([\s\S]*?)<\/h2>/i;
const chapterNo = (s: string) => /^\s*chapter\s*(\d+)/i.exec(s.replace(/<[^>]*>/g, ""))?.[1];
function dropDupHeading(html: string): string {
  const m = LEAD.exec(html);
  if (!m || !chapterNo(m[3]) || chapterNo(m[3]) !== chapterNo(m[2])) return html;
  return m[1] + html.slice(m[0].length);
}

export const clean = (html: string): string => dropDupHeading(purify.sanitize(html));
