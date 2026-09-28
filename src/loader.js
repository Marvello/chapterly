// Loads WebToEpub's browser code (core + all site parsers) into a jsdom window
// so the parsers can run headless in Node.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { browserFetch } = require("./browserFetch");

const PLUGIN_DIR = path.join(__dirname, "..", "vendor-WebToEpub", "plugin");

// UI-only files we replace with stubs instead of loading. (DefaultParserUI.js is loaded: it also
// defines DefaultParserSiteSettings, which DefaultParser needs; its UI hook is patched below.)
const SKIP = new Set([
    "js/main.js", "js/ChapterUrlsUI.js", "js/ProgressBar.js",
    "js/CoverImageUI.js", "js/ErrorLog.js", "js/Download.js", "js/Library.js",
]);

// Third-party libs (zip.js, DOMPurify) are copied into plugin/ by WebToEpub's own npm postinstall,
// which we don't run; fall back to our node_modules copies of the same packages.
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

function scriptList() {
    const html = fs.readFileSync(path.join(PLUGIN_DIR, "popup.html"), "utf8");
    return [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
        .map(m => m[1])
        .filter(s => s && !SKIP.has(s))
        .map(s => ({ rel: s, file: [path.join(PLUGIN_DIR, s), path.join(NODE_MODULES, s)].find(f => fs.existsSync(f)) }));
}

// Minimal stand-ins for the extension's UI / chrome.* globals.
const STUBS = `
var chrome = { i18n: { getMessage: (k, subs) => __hooks.i18n(k, subs) }, runtime: { getManifest: () => ({ version: "headless" }), getURL: () => "" },
    cookies: { getAll: async () => [], set: () => {} },
    declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} } };
var browser = chrome;
class ErrorLog {
    static log(e) { __hooks.onError(e); }
    // No user to click "Retry": cancel, or fetches waiting on the prompt never settle.
    static showErrorMessage(e) { __hooks.onError(e); e?.cancelAction?.(); }
    static clearHistory() {}
}
class ProgressBar { static setMax() {} static setValue() {} static updateValue() {} }
class ChapterUrlsUI {
    constructor() {}
    static showDownloadState() {}
    static setVisibleUI() {}
    showTocProgress() {}
    static get DOWNLOAD() { return "download"; }
    static get SLEEPING() { return "sleeping"; }
    static get LOADED() { return "loaded"; }
    static get NONE() { return "none"; }
}
class CoverImageUI { static clearUI() {} static showCoverImageUrlInput() {} static onCoverImageClicked() {} }
class Library {}
var main = { getUserPreferences: () => __hooks.userPreferences, onLoadFirstPage: () => {} };
`;

/**
 * @param {object} opts
 * @param {function} [opts.fetch]   fetch implementation (default: browserFetch, Cloudflare-friendly)
 * @param {object}   [opts.headers] extra request headers (e.g. User-Agent, Cookie)
 * @param {function} [opts.onError] called with errors WebToEpub would show in its UI
 */
function loadWebToEpub(opts = {}) {
    // Use popup.html's markup (scripts stripped) so code that looks up its UI elements finds them.
    const popup = fs.readFileSync(path.join(PLUGIN_DIR, "popup.html"), "utf8")
        .replace(/<script[\s\S]*?<\/script>/g, "");
    const dom = new JSDOM(popup, {
        url: "https://webtoepub.local/popup.html",   // gives us localStorage
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const w = dom.window;
    // browserFetch generates a consistent Chrome User-Agent itself; only override it via opts.headers.
    const realFetch = opts.fetch || browserFetch;
    const headers = opts.headers || {};

    // Web APIs jsdom doesn't provide but Node does.
    for (const k of ["TextDecoder", "TextEncoder", "Response", "Headers", "Request",
        "AbortController", "structuredClone", "crypto",
        "ReadableStream", "WritableStream", "TransformStream", "CompressionStream", "DecompressionStream"]) {
        if (w[k] === undefined) w[k] = globalThis[k];
    }
    // jsdom's Blob lacks arrayBuffer()/stream(), which zip.js (EPUB packing) needs.
    w.Blob = globalThis.Blob;

    // jsdom lacks innerText (layout-dependent); textContent is a close-enough stand-in.
    if (!("innerText" in w.HTMLElement.prototype)) {
        Object.defineProperty(w.HTMLElement.prototype, "innerText", {
            get() { return this.textContent; },
            set(v) { this.textContent = v; },
            configurable: true,
        });
    }

    // Browser fetch with credentials:"include" -> Node fetch with our headers.
    w.fetch = (url, init = {}) => {
        const { credentials, ...rest } = init;   // eslint-disable-line no-unused-vars
        return realFetch(String(url), { ...rest, headers: { ...headers, ...(rest.headers || {}) } });
    };
    const messages = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "_locales/en/messages.json"), "utf8"));
    const i18n = (key, subs) => {
        const name = String(key).replace(/^__MSG_|__$/g, "");
        const entry = messages[name];
        if (!entry) return name;
        const args = [].concat(subs ?? []);
        const sub = s => s.replace(/\$(\d+)/g, (_, n) => args[n - 1] ?? "");
        // Chrome i18n: named $placeholder$ -> its "content" ($1, $2...) -> argument
        return entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (m, ph) => {
            const def = entry.placeholders?.[ph.toLowerCase()];
            return def ? sub(def.content) : m;
        }).replace(/\$\$/g, "$");
    };
    w.__hooks = { i18n, onError: opts.onError || (e => console.error("[WebToEpub]", e?.message || e)) };

    // vm.Script (not eval) so top-level class/let declarations are shared between files
    const ctx = dom.getInternalVMContext();
    const run = (code, filename) => new vm.Script(code, { filename }).runInContext(ctx);
    run(STUBS, "stubs.js");
    const failed = [];
    for (const { rel, file } of scriptList()) {
        if (!file) {
            failed.push({ file: rel, error: "not found in plugin/ or node_modules/" });
            continue;
        }
        try {
            run(fs.readFileSync(file, "utf8"), rel);
        } catch (e) {
            failed.push({ file: rel, error: e.message });
        }
    }
    w.__hooks.userPreferences = run("UserPreferences.readFromLocalStorage()", "init.js");
    // jsdom can't decode images, so <img>.onload never fires and this would hang. Without
    // dimensions WebToEpub writes a plain <img> instead of an SVG wrapper, which is fine.
    run("ImageCollector.prototype.getImageDimensions = async () => null;", "patches.js");
    // No config panel headless: DefaultParser would otherwise try to fill popup.html's UI.
    run("DefaultParserUI.setupDefaultParserUI = () => {};", "patches.js");
    return { window: w, run, failed };
}

module.exports = { loadWebToEpub };
