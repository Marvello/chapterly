// Copy of worker/src/clean.js (common-tech "copy, don't depend"): every rule applied to chapter HTML.
// Change a rule there and here together, and bump CLEAN_VERSION (lib/cleanVersion.ts) — the parity test checks both.
// Used by the reader API to re-clean chapters stored with an older CLEAN_VERSION.
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

export { CLEAN_VERSION } from "./cleanVersion";

const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);
// Scraped pages may carry their own CSS, fake login forms and remote images (tracking pixels): all dropped.
const CONFIG = { FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "img", "svg", "math"] };
// Inline style stays, but only these properties and no functions (url(), image-set()…): WebToEpub itself turns
// <u>/<s>/<center> into inline styles, and some sites hide watermarks with an inline display:none.
const SAFE_STYLE = /^\s*(text-align|text-decoration|font-style|font-weight|display)\s*:[^()]*$/i;
purify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return;
  data.attrValue = data.attrValue.split(";").filter(d => SAFE_STYLE.test(d)).join(";");
  if (!data.attrValue.trim()) data.keepAttr = false;
});

// Sites like freewebnovel repeat the chapter title as an <h2> right under WebToEpub's <h1>.
const LEAD = /^(\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*)<h2\b[^>]*>([\s\S]*?)<\/h2>/i;
const chapterNo = (s: string) => /^\s*chapter\s*(\d+)/i.exec(s.replace(/<[^>]*>/g, ""))?.[1];
function dropDupHeading(html: string): string {
  const m = LEAD.exec(html);
  if (!m || !chapterNo(m[3]) || chapterNo(m[3]) !== chapterNo(m[2])) return html;
  return m[1] + html.slice(m[0].length);
}

export const clean = (html: string): string => dropDupHeading(purify.sanitize(html, CONFIG));
