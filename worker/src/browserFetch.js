// fetch() look-alike backed by got-scraping: Chrome-like TLS + HTTP/2 + generated headers,
// which gets past Cloudflare's bot check where plain Node fetch gets a 403.
// Same setup as folionix's IDX provider (app/src/providers/idx.ts).
"use strict";
const dns = require("node:dns");
const net = require("node:net");
const { CookieJar } = require("tough-cookie");

// One session per process: the jar keeps Cloudflare cookies, the token keeps the
// generated fingerprint consistent across requests.
const cookieJar = new CookieJar();
const sessionToken = {};
let got;
// got-scraping's own default is 60 s. A timeout fails the request like any other error, so it goes
// through the normal retry backoff (chapter, or whole check when it's the TOC).
const timeoutMs = () => Number(process.env.CHAPTERLY_FETCH_TIMEOUT_SEC || 120) * 1000;
const MAX_BYTES = 20 * 1024 * 1024;   // a chapter page is ~100 KB; covers are the biggest thing we fetch

// SSRF guard: novel URLs come from the web UI, so never fetch the cluster, the LAN or the host itself.
// Checked before the request and each redirect (got-scraping's ALPN probe connects without our dnsLookup,
// and IP literals skip lookup), and again at connect time via dnsLookup (DNS rebinding).
// ponytail: the ALPN probe (a bare TLS handshake) to a host that rebinds right after the check slips through.
// CHAPTERLY_ALLOW_PRIVATE=1 turns it off (tests, or scraping a site on your own network).
const privateNets = new net.BlockList();
for (const [addr, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]]) privateNets.addSubnet(addr, bits, "ipv4");
for (const [addr, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) privateNets.addSubnet(addr, bits, "ipv6");
const allowPrivate = () => process.env.CHAPTERLY_ALLOW_PRIVATE === "1";
const isPrivate = ip => !allowPrivate() && privateNets.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4");
const refuse = (host, ip) => Object.assign(new Error(`Refusing to fetch ${host}: private address ${ip}`), { code: "EPRIVATE" });

async function assertPublicUrl(url) {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (allowPrivate()) return;
    const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map(a => a.address);
    const bad = ips.find(isPrivate);
    if (bad) throw refuse(host, bad);
}

function publicLookup(hostname, options, cb) {
    if (typeof options === "function") [cb, options] = [options, {}];
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) return cb(err);
        const bad = [].concat(address).map(a => a.address ?? a).find(isPrivate);   // options.all → array
        if (bad) return cb(refuse(hostname, bad));
        cb(null, address, family);
    });
}

async function browserFetch(url, init = {}) {
    got ??= (await import("got-scraping")).gotScraping;
    await assertPublicUrl(url);
    const req = got({
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
        dnsLookup: publicLookup,
        hooks: { beforeRedirect: [opts => assertPublicUrl(opts.url)] },
    });
    let tooBig = false;
    req.on("downloadProgress", p => { if (p.transferred > MAX_BYTES) { tooBig = true; req.cancel(); } });
    const r = await req.catch(e => { throw tooBig ? new Error(`Response from ${url} is over ${MAX_BYTES >> 20} MB`) : e; });
    const headers = new Headers();
    for (const [k, v] of Object.entries(r.headers)) {
        if (!k.startsWith(":")) headers.set(k, [].concat(v).join(", "));
    }
    const nullBody = [101, 204, 205, 304].includes(r.statusCode);
    const res = new Response(nullBody ? null : r.rawBody, { status: r.statusCode, headers });
    Object.defineProperty(res, "url", { value: r.url });   // final URL after redirects
    return res;
}

module.exports = { browserFetch, MAX_BYTES };
