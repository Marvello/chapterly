import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { clean, CLEAN_VERSION } from "./clean";

const require = createRequire(import.meta.url);
const worker = require("../../worker/src/clean.js") as { clean: (html: string) => string; CLEAN_VERSION: number };

const FIXTURES = [
  `<h1>T</h1><p onclick="x()">a <a href="javascript:alert(1)">l</a></p>` +
    `<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://e.com"></iframe><p>ok</p>`,
  "<h1>Chapter 236 | Kreg!</h1><h2>Chapter 236: 236 | Kreg!</h2><p>a</p>",
  "<h1>Chapter 2: Rain</h1><h2>Part One</h2><p>b</p>",
];

describe("clean", () => {
  it("removes scripts, handlers, javascript: links and iframes, keeps text", () => {
    const out = clean(FIXTURES[0]);
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain("<p>ok</p>");
  });
  it("drops the repeated chapter heading, keeps a real subtitle", () => {
    expect(clean(FIXTURES[1])).toBe("<h1>Chapter 236 | Kreg!</h1><p>a</p>");
    expect(clean(FIXTURES[2])).toBe(FIXTURES[2]);
  });
  it("matches the worker's copy, rules and version", () => {
    for (const f of FIXTURES) expect(clean(f)).toBe(worker.clean(f));
    expect(CLEAN_VERSION).toBe(worker.CLEAN_VERSION);
  });
});
