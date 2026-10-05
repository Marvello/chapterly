// Chapter HTML is shown in the reader as stored, so the worker must store it cleaned.
"use strict";
const assert = require("assert");
const { clean } = require("../src/clean");

const out = clean(`<h1>T</h1><p onclick="x()">a <a href="javascript:alert(1)">l</a></p>` +
    `<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://e.com"></iframe><p>ok</p>`);
assert.ok(!/script|onclick|onerror|javascript:|iframe/i.test(out), out);
assert.ok(out.includes("<h1>T</h1>") && out.includes("<p>ok</p>"), out);

// The site's repeated "Chapter N" <h2> under WebToEpub's <h1> is dropped; a real subtitle stays.
assert.strictEqual(clean("<h1>Chapter 236 | Kreg!</h1><h2>Chapter 236: 236 | Kreg!</h2><p>a</p>"), "<h1>Chapter 236 | Kreg!</h1><p>a</p>");
for (const keep of ["<h1>Chapter 2: Rain</h1><h2>Part One</h2><p>b</p>", "<h1>Chapter 2</h1><h2>Chapter 3</h2>",
    "<p>x</p><h1>Chapter 1</h1><h2>Chapter 1</h2>"]) assert.strictEqual(clean(keep), keep);
// Scraped CSS, forms (fake logins), remote images (tracking) and svg/math go; only safe inline styles stay.
const page = clean(`<style>p{}</style><form action="https://e.com"><input name=p><button>Go</button></form>` +
    `<img src="https://t.example/x.gif"><svg><text>s</text></svg><math><mi>m</mi></math>` +
    `<p style="text-decoration: line-through; background:url(https://t.example/y)">x</p><span style="position:fixed">y</span>`);
assert.ok(!/<style|<form|<input|<button|<img|<svg|<math|url\(|position/i.test(page), page);
assert.ok(page.includes(`<p style="text-decoration: line-through">x</p><span>y</span>`), page);
console.log("✓ clean test passed");
