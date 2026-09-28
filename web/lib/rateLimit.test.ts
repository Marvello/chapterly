import { expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

it("allows `limit` hits per window per key", () => {
  const allow = createRateLimiter(3, 60_000);
  expect([0, 1, 2, 3].map(i => allow("1.2.3.4", 1000 + i))).toEqual([true, true, true, false]);
  expect(allow("5.6.7.8", 1004)).toBe(true);
  expect(allow("1.2.3.4", 1000 + 60_000)).toBe(true); // oldest hit left the window
});
