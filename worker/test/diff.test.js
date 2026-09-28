"use strict";
const assert = require("assert");
const { diffChapters } = require("../src/diff");

const known = [
    { url: "http://www.site.com/n/ch-1/", title: "Chapter 1" },
    { url: "https://site.com/n/ch-2", title: "Chapter 2" },
];
const fresh = [
    { url: "https://site.com/n/ch-1", title: "Chapter 1" },          // same, URL normalized
    { url: "https://site.com/n/chapter-2-new-slug", title: "Chapter 2" }, // URL changed, title same
    { url: "https://site.com/n/ch-3", title: "Chapter 3" },          // new
];
const { added, removed } = diffChapters(known, fresh);
assert.deepStrictEqual(added.map(c => c.title), ["Chapter 3"]);
assert.deepStrictEqual(removed, []);
console.log("✓ diff test passed");
