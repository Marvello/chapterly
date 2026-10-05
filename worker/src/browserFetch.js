// fetch() look-alike backed by got-scraping: Chrome-like TLS + HTTP/2 + generated headers,
// which gets past Cloudflare's bot check where plain Node fetch gets a 403.
// Same setup as folionix's IDX provider (app/src/providers/idx.ts).
"use strict";
const { CookieJar } = require("tough-cookie");

// One session per process: the jar keeps Cloudflare cookies, the token keeps the
// generated fingerprint consistent across requests.
const cookieJar = new CookieJar();
const sessionToken = {};
let got;
// got-scraping's own default is 60 s. A timeout fails the request like any other error, so it goes
// through the normal retry backoff (chapter, or whole check when it's the TOC).
const timeoutMs = () => Number(process.env.CHAPTERLY_FETCH_TIMEOUT_SEC || 120) * 1000;

async function browserFetch(url, init = {}) {
    got ??= (await import("got-scraping")).gotScraping;
    const r = await got({
        url: String(url),
        method: init.method || "GET",
        headers: init.headers,
        body: init.body,
        http2: true,
        useHeaderGenerator: true,
        headerGeneratorOptions: { browsers: [{ name: "chrome", minVersion: 120 }] },
        cookieJar,
        sessionToken,
        throwHttpErrors: false,
        timeout: { request: timeoutMs() },
        responseType: "buffer",
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(r.headers)) {
        if (!k.startsWith(":")) headers.set(k, [].concat(v).join(", "));
    }
    const nullBody = [101, 204, 205, 304].includes(r.statusCode);
    const res = new Response(nullBody ? null : r.rawBody, { status: r.statusCode, headers });
    Object.defineProperty(res, "url", { value: r.url });   // final URL after redirects
    return res;
}

module.exports = { browserFetch };
