import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import type { UserRow } from "./db";
import { verifyPasswordLogin, type LoginDeps } from "./passwordLogin";

process.env.BCRYPT_ROUNDS = "4";
const PASSWORD = "correct horse battery";
let hash = "";
beforeAll(async () => { hash = await bcrypt.hash(PASSWORD, 4); });

function setup(overrides: Partial<UserRow> = {}, allowIp = true) {
  const user: UserRow = { id: 1, name: "Me", email: "me@example.com", password_hash: hash, failed_logins: 0,
    locked_until: null, session_version: 1, oidc_sub: null, created_at: "", ...overrides };
  const events: Array<[string, Record<string, unknown> | undefined]> = [];
  const deps: LoginDeps = {
    db: {
      getUserByEmail: e => (e.toLowerCase() === user.email ? user : undefined),
      recordLoginFailure: (_id, until) => { user.failed_logins++; user.locked_until = until; },
      recordLoginSuccess: () => { user.failed_logins = 0; user.locked_until = null; },
    },
    log: (event, fields) => events.push([event, fields]),
    allowIp: () => allowIp,
    now: () => Date.parse("2026-01-01T00:00:00Z"),
  };
  return { user, events, deps };
}

describe("verifyPasswordLogin", () => {
  it("correct password → user, resets failures, logs success", async () => {
    const { user, events, deps } = setup({ failed_logins: 3 });
    expect(await verifyPasswordLogin("Me@Example.com", PASSWORD, "ip", deps)).toEqual({ id: "1", email: "me@example.com", name: "Me" });
    expect(user.failed_logins).toBe(0);
    expect(events[0][0]).toBe("login_success");
  });
  it("unknown user and wrong password both return null (no enumeration)", async () => {
    const { deps } = setup();
    expect(await verifyPasswordLogin("nobody@example.com", PASSWORD, "ip", deps)).toBeNull();
    expect(await verifyPasswordLogin("me@example.com", "wrong password!!", "ip", deps)).toBeNull();
  });
  it("5th failure locks; a locked account rejects even the right password", async () => {
    const { user, events, deps } = setup({ failed_logins: 4 });
    expect(await verifyPasswordLogin("me@example.com", "wrong password!!", "ip", deps)).toBeNull();
    expect(user.locked_until).toBe("2026-01-01T00:01:00.000Z");
    expect(events.at(-1)?.[0]).toBe("account_locked");
    expect(await verifyPasswordLogin("me@example.com", PASSWORD, "ip", deps)).toBeNull();
    expect(events.at(-1)?.[1]).toMatchObject({ reason: "locked" });
  });
  it("rate-limited IP is rejected before any lookup", async () => {
    const { events, deps } = setup({}, false);
    expect(await verifyPasswordLogin("me@example.com", PASSWORD, "9.9.9.9", deps)).toBeNull();
    expect(events[0]).toEqual(["login_rate_limited", { email: "me@example.com", ip: "9.9.9.9" }]);
  });
  it("rejects non-string and oversized input without touching the DB", async () => {
    const { deps } = setup();
    expect(await verifyPasswordLogin(undefined, PASSWORD, "ip", deps)).toBeNull();
    expect(await verifyPasswordLogin("me@example.com", "x".repeat(2000), "ip", deps)).toBeNull();
  });
  it("never logs the password", async () => {
    const { events, deps } = setup();
    await verifyPasswordLogin("me@example.com", "wrong password!!", "ip", deps);
    expect(JSON.stringify(events)).not.toContain("wrong password");
  });
});
