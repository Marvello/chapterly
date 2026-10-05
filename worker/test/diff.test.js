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

// Repeated titles are still new chapters when every stored chapter is still listed.
const ann = [{ url: "https://site.com/n/a1", title: "Announcement" }];
assert.deepStrictEqual(diffChapters(ann, [...ann, { url: "https://site.com/n/a2", title: "Announcement" }]).added.map(c => c.url),
    ["https://site.com/n/a2"]);
// CJK titles keep their letters: "第10章 开始" and "第10章 结束" are different chapters.
const cjk = [{ url: "https://site.com/n/10a", title: "第10章 开始" }];
assert.deepStrictEqual(diffChapters(cjk, [{ url: "https://site.com/n/10b", title: "第10章 结束" }]).added.map(c => c.title),
    ["第10章 结束"]);
console.log("✓ diff test passed");
