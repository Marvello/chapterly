import { expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rateLimit";

it("allows `limit` hits per window per key", () => {
  const allow = createRateLimiter(3, 60_000);
  expect([0, 1, 2, 3].map(i => allow("1.2.3.4", 1000 + i))).toEqual([true, true, true, false]);
  expect(allow("5.6.7.8", 1004)).toBe(true);
  expect(allow("1.2.3.4", 1000 + 60_000)).toBe(true); // oldest hit left the window
});

it("trusts cf-connecting-ip only when told to, x-forwarded-for never", () => {
  const h = new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
  expect(clientIp(h, true)).toBe("1.2.3.4");
  expect(clientIp(h, false)).toBe("unknown");
  expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8" }), true)).toBe("unknown");
});
