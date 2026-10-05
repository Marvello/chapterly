import { expect, it } from "vitest";
import { proxyDecision } from "./proxyRules";

it("signed out: API → 401, pages → login, public files pass", () => {
  expect(proxyDecision("/api/reader/library", false)).toBe("unauthorized");
  expect(proxyDecision("/read", false)).toBe("login");
  for (const p of ["/login", "/api/auth/signin", "/api/health", "/manifest.webmanifest", "/sw.js", "/icon-192.png", "/icon-512.png"]) {
    expect(proxyDecision(p, false)).toBe("next");
  }
});

it("signed in: everything passes", () => {
  expect(proxyDecision("/api/reader/library", true)).toBe("next");
  expect(proxyDecision("/read", true)).toBe("next");
});
