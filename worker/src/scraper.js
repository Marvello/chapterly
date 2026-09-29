// Headless API over WebToEpub's parsers.
//   const s = createScraper();
//   const novel = await s.getNovel(tocUrl);          // metadata + chapter list
//   const ch = await s.getChapter(novel, chapterUrl); // cleaned XHTML-ready HTML
"use strict";
const { loadWebToEpub } = require("./loader");

/** Site's og:novel:status text → ongoing / completed / dropped, or null when absent. */
function mapSiteStatus(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return null;
    if (/drop|hiatus|abandon|discontinu|cancel|suspend/.test(t)) return "dropped";
    if (/complet|finish|\bended\b/.test(t)) return "completed";   // whole word: not "pending"/"suspended"
    return "ongoing";
}

function createScraper(opts = {}) {
    const errors = [];
    const env = loadWebToEpub({ ...opts, onError: e => errors.push(String(e?.message || e)) });
    const { window: w, run } = env;
    const prefs = w.__hooks.userPreferences;
    const ParserFactory = run("ParserFactory");
    const parserFactory = run("parserFactory");
    const HttpClient = run("HttpClient");
    const ChapterUrlsUI = run("ChapterUrlsUI");
    const DefaultParser = run("DefaultParser");

    async function fetchDom(url) {
        const res = await HttpClient.wrapFetch(url);
        if (!res?.responseXML) throw new Error(`No HTML returned for ${url}`);
        return res.responseXML;
    }

    function makeParser(url, dom) {
        const parser = parserFactory.fetch(url, dom);
        parser.onUserPreferencesUpdate(prefs);
        // Images are handled by our own pipeline later; keep <img src> as absolute URLs.
        parser.imageCollector.replaceImageTags = el => {
            for (const img of el.querySelectorAll("img")) {
                if (img.src) img.setAttribute("src", img.src);
            }
        };
        return parser;
    }

    /** Resolve which parser handles a URL, without fetching anything. */
    function parserNameFor(url) {
        const p = parserFactory.fetchByUrl(url);
        return p ? p.constructor.name : null;
    }

    async function getNovel(tocUrl) {
        errors.length = 0;
        const dom = await fetchDom(tocUrl);
        const parser = makeParser(tocUrl, dom);
        await parser.loadEpubMetaInfo(dom);
        const meta = parser.getEpubMetaInfo(dom, true);
        let chapters = await parser.getChapterUrls(dom, new ChapterUrlsUI(parser));
        chapters = parser.cleanWebPageUrls(chapters || []);
        let cover = null;
        try { cover = parser.findCoverImageUrl(dom) || null; } catch { /* optional */ }
        let description = "";
        try {
            description = parser.getInformationEpubItemChildNodes(dom)
                .map(n => n.textContent.trim()).filter(Boolean).join("\n\n");
        } catch { /* optional */ }
        return {
            siteStatus: mapSiteStatus(dom.querySelector('meta[property="og:novel:status"]')?.getAttribute("content")),
            url: tocUrl,
            parser: parser.constructor.name,
            usingDefaultParser: parser instanceof DefaultParser,
            title: meta.title || "",
            author: meta.author || "",
            language: meta.language || "",
            subjects: meta.subject || "",
            description: description || meta.description || "",
            cover,
            throttleMs: parser.getRateLimit(),
            chapters: chapters.map((c, i) => ({ index: i, url: c.sourceUrl, title: (c.title || "").trim() })),
            warnings: [...errors],
            _parser: parser,   // reuse for chapter fetches (keeps site-specific state)
        };
    }

    // Like Parser.setPagesToFetch: the previous and next chapter URLs, so convertRawDomToContent
    // strips "previous/next chapter" links from the content.
    const normalizeUrl = run("(u) => util.normalizeUrlForCompare(u)", "normalizeUrl.js");
    function neighbourUrls(chapters = [], chapterUrl) {
        const i = chapters.findIndex(c => c.url === chapterUrl);
        return new Set([chapters[i - 1], chapters[i + 1]].filter(c => i >= 0 && c).map(c => normalizeUrl(c.url)));
    }

    async function getChapter(novelOrUrl, chapterUrl, { throttle = true } = {}) {
        errors.length = 0;
        let parser = novelOrUrl?._parser;
        if (!parser) {
            parser = makeParser(chapterUrl, null);
        }
        if (throttle) await parser.rateLimitDelay();
        const rawDom = await parser.fetchChapter(chapterUrl);
        parser.preprocessRawDom(rawDom);
        parser.removeUnusedElementsToReduceMemoryConsumption(rawDom);
        if (parser.findContent(rawDom) == null) {
            throw new Error(`Content element not found on ${chapterUrl} (parser ${parser.constructor.name})`);
        }
        const webPage = { sourceUrl: chapterUrl, rawDom, title: "[placeholder]", isIncludeable: true,
            nextPrevChapters: neighbourUrls(novelOrUrl?.chapters, chapterUrl) };
        const content = parser.convertRawDomToContent(webPage);
        return {
            url: chapterUrl,
            title: webPage.title,
            html: content.innerHTML,
            text: content.textContent.replace(/\s+/g, " ").trim(),
            warnings: [...errors],
        };
    }

    // Packs with WebToEpub's own EpubPacker, so the output matches the extension's EPUB 3.
    const packInVm = run(`(async (meta, chapters, coverUrl, prefs) => {
        const parser = parserFactory.fetchByUrl(meta.uuid) || new DefaultParser();
        parser.onUserPreferencesUpdate(prefs);
        const info = Object.assign(new EpubMetaInfo(), meta);
        if (coverUrl) {
            parser.imageCollector.setCoverImageUrl(coverUrl);
            await parser.imageCollector.fetchImages(() => {}, meta.uuid);
            if (!parser.imageCollector.coverImageInfo?.arraybuffer) parser.imageCollector.reset();
        }
        const packer = new EpubPacker(info, EpubPacker.EPUB_VERSION_3);
        // Render each chapter's XHTML up front, one at a time, yielding to the event loop now and
        // then. DOMPurify's per-node sanitize makes a jsdom NodeIterator that jsdom tracks with a
        // WeakRef, and V8 keeps WeakRef targets (and their whole temp document) alive until the
        // current task ends: packing thousands of chapters in one synchronous assemble() ran out
        // of heap (4804 chapters > 4 GB). A timer tick releases them; a microtask does not.
        const items = [];
        for (const [i, c] of chapters.entries()) {
            const div = document.createElement("div");
            div.innerHTML = c.html;
            const item = new ChapterEpubItem({ sourceUrl: c.url, title: c.title }, div, i);
            const svg = item.hasSvg();   // reads the nodes, which rendering deletes
            const xml = item.fileContentForEpub(packer.emptyDocFactory, packer.contentValidator);
            Object.assign(item, { hasSvg: () => svg, fileContentForEpub: () => xml });
            items.push(item);
            if (i % 50 === 49) await new Promise(r => setTimeout(r));
        }
        const supplier = new EpubItemSupplier(parser, items, parser.imageCollector);
        return packer.assemble(supplier);
    })`, "packEpub.js");

    /**
     * @param {{tocUrl,title,author,language?,subjects?,description?,cover?}} novel
     * @param {Array<{url,title,html}>} chapters  in reading order
     * @returns {Promise<Buffer>} the .epub file
     */
    async function buildEpub(novel, chapters) {
        errors.length = 0;
        const meta = {
            uuid: novel.tocUrl, title: novel.title || "Untitled", author: novel.author || "Unknown",
            language: novel.language || "en", subject: novel.subjects || "", description: novel.description || "",
        };
        const blob = await packInVm(meta, chapters, novel.cover || null, prefs);
        return Buffer.from(await blob.arrayBuffer());
    }

    /** Hostnames (without www.) that have a dedicated parser — no fetching involved. */
    const supportedHosts = () => [...parserFactory.parsers.keys()];

    return { getNovel, getChapter, buildEpub, parserNameFor, supportedHosts, loadFailures: env.failed, ParserFactory };
}

module.exports = { createScraper, mapSiteStatus };
