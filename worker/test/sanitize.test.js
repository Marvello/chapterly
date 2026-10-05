// Chapter HTML is shown in the reader as stored, so the worker must store it sanitized.
"use strict";
const assert = require("assert");
const { sanitize } = require("../src/sanitize");

const out = sanitize(`<h1>T</h1><p onclick="x()">a <a href="javascript:alert(1)">l</a></p>` +
    `<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://e.com"></iframe><p>ok</p>`);
assert.ok(!/script|onclick|onerror|javascript:|iframe/i.test(out), out);
assert.ok(out.includes("<h1>T</h1>") && out.includes("<p>ok</p>"), out);
console.log("✓ sanitize test passed");
