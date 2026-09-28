// Asks Audiobookshelf to rescan its library right after an EPUB is written, instead of waiting for
// ABS's own nightly scan. Best effort: failures are logged, never thrown.
// ABS API: GET /api/libraries, POST /api/libraries/:id/scan (admin only) with a Bearer API key.
"use strict";

const absConfigFromEnv = env => ({
    url: env.CHAPTERLY_ABS_URL, token: env.CHAPTERLY_ABS_TOKEN, library: env.CHAPTERLY_ABS_LIBRARY,
});

/** @returns {null | (reason: string) => Promise<void>} null when ABS isn't configured. */
function createAbsNotifier({ url, token, library }, log = console.log) {
    const set = [url, token, library].filter(Boolean).length;
    if (set === 0) return null;
    if (set !== 3) {
        throw new Error("Audiobookshelf is partially configured: set CHAPTERLY_ABS_URL, CHAPTERLY_ABS_TOKEN and CHAPTERLY_ABS_LIBRARY, or none");
    }
    const base = url.replace(/\/+$/, "");
    let libraryId;

    async function call(method, path) {
        const res = await fetch(base + path, {
            method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
        return res;
    }

    // Accept the library's id or its name (e.g. "Ebooks"); looked up once, then cached.
    async function resolveLibrary() {
        const { libraries } = await (await call("GET", "/api/libraries")).json();
        const lib = libraries.find(l => l.id === library || l.name.toLowerCase() === library.toLowerCase());
        if (!lib) throw new Error(`no Audiobookshelf library "${library}" (have: ${libraries.map(l => l.name).join(", ")})`);
        return lib.id;
    }

    return async function notify(reason) {
        try {
            libraryId ??= await resolveLibrary();
            await call("POST", `/api/libraries/${libraryId}/scan`);
            log(`Audiobookshelf: scan requested (${reason})`);
        } catch (e) {
            log(`Audiobookshelf: scan request failed: ${e.message}`);
        }
    };
}

module.exports = { createAbsNotifier, absConfigFromEnv };
