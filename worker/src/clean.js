// Every rule applied to chapter HTML before anyone reads it (reader, EPUB) lives here, nowhere else.
// web/lib/clean.ts is the web app's copy (common-tech "copy, don't depend"); a parity test keeps them equal.
// Changing a rule? Bump CLEAN_VERSION (in both copies): chapters stored with an older version
// (chapters.html_clean) are cleaned again on their next read or EPUB build, and phones re-download theirs.
"use strict";
const createDOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");

const CLEAN_VERSION = 2;   // 1 = DOMPurify; 2 = + repeated chapter heading

const purify = createDOMPurify(new JSDOM("").window);

// Sites like freewebnovel repeat the chapter title as an <h2> right under WebToEpub's <h1>.
const LEAD = /^(\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*)<h2\b[^>]*>([\s\S]*?)<\/h2>/i;
const chapterNo = s => /^\s*chapter\s*(\d+)/i.exec(s.replace(/<[^>]*>/g, ""))?.[1];
function dropDupHeading(html) {
    const m = LEAD.exec(html);
    if (!m || !chapterNo(m[3]) || chapterNo(m[3]) !== chapterNo(m[2])) return html;
    return m[1] + html.slice(m[0].length);
}

const clean = html => dropDupHeading(purify.sanitize(html));

module.exports = { clean, CLEAN_VERSION };
