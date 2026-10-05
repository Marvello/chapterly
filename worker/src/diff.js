// Decide which chapters from a fresh TOC are new compared with what's stored.
// Aggregators sometimes change URL formats (http/https, trailing slash, www),
// so match on a normalized URL first, then fall back to normalized title.
"use strict";

function normUrl(u) {
    try {
        const x = new URL(u);
        return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
    } catch { return String(u).toLowerCase(); }
}
// Keeps letters/digits of every script (CJK titles like "第10章 开始" must not collapse to "10").
const normTitle = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Title matching only pairs a new URL with an orphaned stored chapter (its URL gone from the TOC), so a
 * renamed slug isn't re-added, while repeated titles ("Announcement") still count as new chapters.
 * @param {Array<{url:string,title?:string}>} known  chapters already stored
 * @param {Array<{url:string,title?:string}>} fresh  chapters from the current TOC
 * @returns {{added: Array, removed: Array}}
 */
function diffChapters(known, fresh) {
    const knownUrls = new Set(known.map(c => normUrl(c.url)));
    const freshUrls = new Set(fresh.map(c => normUrl(c.url)));
    const titlesOf = list => new Set(list.map(c => normTitle(c.title)).filter(Boolean));
    const orphanTitles = titlesOf(known.filter(c => !freshUrls.has(normUrl(c.url))));
    const newTitles = titlesOf(fresh.filter(c => !knownUrls.has(normUrl(c.url))));
    const added = fresh.filter(c => !knownUrls.has(normUrl(c.url)) && !orphanTitles.has(normTitle(c.title)));
    const removed = known.filter(c => !freshUrls.has(normUrl(c.url)) && !newTitles.has(normTitle(c.title)));
    return { added, removed };
}

module.exports = { diffChapters, normUrl };
