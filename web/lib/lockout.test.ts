import { describe, expect, it } from "vitest";
import { isLocked, lockUntil } from "./lockout";

describe("lockout", () => {
  const at = Date.parse("2026-01-01T00:00:00Z");
  const mins = (n: number) => (Date.parse(lockUntil(n, at)!) - at) / 60_000;
  it("no lock before 5 failures", () => expect(lockUntil(4, at)).toBeNull());
  it("1, 2, 4 … minutes, capped at 60", () => {
    expect([5, 6, 7, 8, 9, 10, 11, 20].map(mins)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });
  it("isLocked compares with now", () => {
    expect(isLocked(null, at)).toBe(false);
    expect(isLocked(new Date(at + 1000).toISOString(), at)).toBe(true);
    expect(isLocked(new Date(at - 1000).toISOString(), at)).toBe(false);
  });
});
