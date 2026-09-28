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
const normTitle = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @param {Array<{url:string,title?:string}>} known  chapters already stored
 * @param {Array<{url:string,title?:string}>} fresh  chapters from the current TOC
 * @returns {{added: Array, removed: Array}}
 */
function diffChapters(known, fresh) {
    const knownUrls = new Set(known.map(c => normUrl(c.url)));
    const knownTitles = new Set(known.map(c => normTitle(c.title)).filter(Boolean));
    const added = fresh.filter(c =>
        !knownUrls.has(normUrl(c.url)) && !(c.title && knownTitles.has(normTitle(c.title))));
    const freshUrls = new Set(fresh.map(c => normUrl(c.url)));
    const freshTitles = new Set(fresh.map(c => normTitle(c.title)).filter(Boolean));
    const removed = known.filter(c =>
        !freshUrls.has(normUrl(c.url)) && !(c.title && freshTitles.has(normTitle(c.title))));
    return { added, removed };
}

module.exports = { diffChapters, normUrl };
