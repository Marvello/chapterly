import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { sanitize } from "./sanitize";

const require = createRequire(import.meta.url);
const worker = require("../../worker/src/sanitize.js") as { sanitize: (html: string) => string };

const FIXTURE = `<h1>T</h1><p onclick="x()">a <a href="javascript:alert(1)">l</a></p>` +
  `<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://e.com"></iframe><p>ok</p>`;

describe("sanitize", () => {
  it("removes scripts, handlers, javascript: links and iframes, keeps text", () => {
    const out = sanitize(FIXTURE);
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe/i);
    expect(out).toContain("<p>ok</p>");
  });
  it("gives the same output as the worker's copy", () => {
    expect(sanitize(FIXTURE)).toBe(worker.sanitize(FIXTURE));
  });
});
