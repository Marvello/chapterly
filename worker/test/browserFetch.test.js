// SSRF guard + size cap of the real fetcher, against a local server (private address, so the guard is
// switched off with CHAPTERLY_ALLOW_PRIVATE where a request should go through).
"use strict";
const assert = require("assert");
const http = require("http");
const { browserFetch, MAX_BYTES } = require("../src/browserFetch");

const big = Buffer.alloc(MAX_BYTES + 1024 * 1024, "a");
const server = http.createServer((req, res) => {
    if (req.url === "/big") return res.end(big);
    if (req.url === "/redirect") {   // a "public" page that redirects into the private network
        process.env.CHAPTERLY_ALLOW_PRIVATE = "0";
        res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/small` });
        return res.end();
    }
    res.end("ok");
});

const refused = async url => {
    await assert.rejects(browserFetch(url), e => /private address/.test(e.message), url);
};

(async () => {
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    try {
        delete process.env.CHAPTERLY_ALLOW_PRIVATE;
        await refused(`http://localhost:${port}/small`);         // hostname → resolved address checked
        await refused(`http://127.0.0.1:${port}/small`);         // IP literal (no lookup happens)
        await refused(`http://[::ffff:127.0.0.1]:${port}/small`);   // IPv4-mapped IPv6
        await refused("http://169.254.169.254/latest/meta-data");   // cloud metadata
        await refused("https://localhost:1/");                   // HTTP/2 / TLS path uses the same lookup

        process.env.CHAPTERLY_ALLOW_PRIVATE = "1";
        assert.strictEqual(await (await browserFetch(`http://localhost:${port}/small`)).text(), "ok");
        await refused(`http://localhost:${port}/redirect`);      // redirect target checked too
        process.env.CHAPTERLY_ALLOW_PRIVATE = "1";
        await assert.rejects(browserFetch(`http://localhost:${port}/big`), /over 20 MB/);
    } finally {
        server.close();
    }
    console.log("✓ browserFetch test passed");
})().catch(e => { console.error(e); process.exit(1); });
