// Audiobookshelf notifier against a small fake ABS server (same routes/shape as ABS 2.36).
"use strict";
const assert = require("assert");
const http = require("http");
const { createAbsNotifier, absConfigFromEnv } = require("../src/audiobookshelf");

(async () => {
    const calls = [];
    let scanStatus = 200;
    const server = http.createServer((req, res) => {
        calls.push(`${req.method} ${req.url} ${req.headers.authorization}`);
        if (req.method === "GET" && req.url === "/api/libraries") {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify({ libraries: [
                { id: "lib-audio", name: "Audiobooks" }, { id: "lib-ebooks", name: "Ebooks" }] }));
        }
        if (req.method === "POST" && /^\/api\/libraries\/[\w-]+\/scan$/.test(req.url)) { res.statusCode = scanStatus; return res.end(); }
        res.statusCode = 404; res.end();
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const logs = [];
    const log = m => logs.push(m);

    // Not configured → no notifier; partially configured → refuse to start.
    assert.strictEqual(createAbsNotifier(absConfigFromEnv({}), log), null);
    assert.throws(() => createAbsNotifier(absConfigFromEnv({ CHAPTERLY_ABS_URL: url }), log), /partially configured/);

    // Library found by name (case-insensitive), bearer token sent, id looked up once.
    const notify = createAbsNotifier({ url: `${url}/`, token: "tok", library: "ebooks" }, log);
    await notify("Novel A");
    await notify("Novel B");
    assert.deepStrictEqual(calls, [
        "GET /api/libraries Bearer tok",
        "POST /api/libraries/lib-ebooks/scan Bearer tok",
        "POST /api/libraries/lib-ebooks/scan Bearer tok",
    ]);
    assert.match(logs.at(-1), /scan requested \(Novel B\)/);
    assert.ok(!logs.join("\n").includes("tok"), "token never logged");

    // Failures are logged, never thrown (a check must not fail because ABS is down or the key isn't admin).
    scanStatus = 403;
    await notify("Novel C");
    assert.match(logs.at(-1), /scan request failed: POST \/api\/libraries\/lib-ebooks\/scan: HTTP 403/);
    const unknown = createAbsNotifier({ url, token: "tok", library: "Comics" }, log);
    await unknown("x");
    assert.match(logs.at(-1), /no Audiobookshelf library "Comics" \(have: Audiobooks, Ebooks\)/);
    const down = createAbsNotifier({ url: "http://127.0.0.1:9", token: "tok", library: "Ebooks" }, log);
    await down("x");
    assert.match(logs.at(-1), /scan request failed/);

    server.close();
    console.log("✓ audiobookshelf test passed");
})().catch(e => { console.error("✗", e); process.exit(1); });
