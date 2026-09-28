// Synthetic site shaped like freewebnovel.com (invented text), served through a mock fetch.
// `site.chapterCount` can be raised mid-test to simulate new chapters being published;
// URLs in `site.broken` return 404.
"use strict";

const BASE = "https://freewebnovel.com/novel/test-story";
// Smallest valid JPEG header bytes are enough: WebToEpub sniffs the type from the first bytes.
const COVER = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

function mockSite(chapterCount = 5) {
    const site = { chapterCount, requests: [], broken: new Set() };
    const chLinks = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) =>
        `<li><a href="/novel/test-story/chapter-${from + i}">Chapter ${from + i}</a></li>`).join("");

    function page(url) {
        const n = site.chapterCount;
        if (url === BASE) {
            return `<html><head><title>Test Story</title></head><body>
              <h1 class="tit">Test Story</h1>
              <div class="pic"><img src="/files/cover.jpg"></div>
              <div class="item"><span title="Author"></span><div class="right"><a>Jane Placeholder</a></div></div>
              <div class="item"><span title="Genre"></span><div class="right"><a>Fantasy</a><a>Adventure</a></div></div>
              <div class="inner"><p>A synthetic synopsis used only for testing.</p></div>
              <ul id="idData">${chLinks(1, Math.min(3, n))}</ul>
              <script>var cfg = { totalPage: ${n > 3 ? 2 : 1} };</script>
            </body></html>`;
        }
        if (url === `${BASE}?ajax=chapters&page=2`) {
            return JSON.stringify({ code: 200, html: `<ul>${chLinks(4, n)}</ul>` });
        }
        if (url === "https://freewebnovel.com/files/cover.jpg") return COVER;
        const m = url.match(/\/chapter-(\d+)$/);
        if (m && Number(m[1]) <= n) {
            return `<html><body>
              <span class="chapter">Chapter ${m[1]}: Placeholder Title</span>
              <div id="article">
                <p>Synthetic paragraph one of chapter ${m[1]}.</p>
                <div id="bg-ssp-123"><p>AD CONTENT</p></div>
                <p>This story originates from somewhere else, ensure the author gets the support.</p>
                <p>Synthetic <sub>junk</sub>paragraph two.</p>
                <p>See <a href="https://example.org/glossary">the glossary</a>.</p>
                <p><a href="/novel/test-story/chapter-${Number(m[1]) + 1}">Next chapter</a></p>
                <script>tracking()</script>
              </div></body></html>`;
        }
        return null;
    }

    site.fetch = async url => {
        url = String(url);
        site.requests.push(url);
        const body = site.broken.has(url) ? null : page(url);
        const type = Buffer.isBuffer(body) ? "image/jpeg"
            : url.includes("ajax=") ? "application/json" : "text/html; charset=utf-8";
        const res = new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": type } });
        Object.defineProperty(res, "url", { value: url });   // real fetch sets this
        return res;
    };
    return site;
}

module.exports = { mockSite, BASE };
