import { describe, expect, it } from "vitest";
import type { UserRow } from "./db";
import { decideOidcLogin } from "./oidcLogin";

const me: UserRow = { id: 1, name: "Me", email: "me@example.com", password_hash: "h", failed_logins: 0,
  locked_until: null, session_version: 1, oidc_sub: null, created_at: "" };
const dbWith = (u: UserRow) => ({
  getUserByOidcSub: (s: string) => (u.oidc_sub === s ? u : undefined),
  getUserByEmail: (e: string) => (e.toLowerCase() === u.email ? u : undefined),
});

describe("decideOidcLogin", () => {
  it("already bound sub → allowed without re-binding (even if email changed)", () => {
    expect(decideOidcLogin({ sub: "abc", email: "new@example.com", email_verified: true }, dbWith({ ...me, oidc_sub: "abc" })))
      .toEqual({ allow: true, userId: 1, bind: false });
  });
  it("first login: verified matching email, unbound user → allowed and bind", () => {
    expect(decideOidcLogin({ sub: "abc", email: "Me@Example.com", email_verified: true }, dbWith(me)))
      .toEqual({ allow: true, userId: 1, bind: true });
  });
  it("rejects unverified email, unknown email, missing sub/email", () => {
    const db = dbWith(me);
    expect(decideOidcLogin({ sub: "abc", email: "me@example.com", email_verified: false }, db)).toMatchObject({ allow: false, reason: "email_not_verified" });
    expect(decideOidcLogin({ sub: "abc", email: "me@example.com" }, db)).toMatchObject({ allow: false, reason: "email_not_verified" });
    expect(decideOidcLogin({ sub: "abc", email: "x@example.com", email_verified: true }, db)).toMatchObject({ allow: false, reason: "unknown_email" });
    expect(decideOidcLogin({ email: "me@example.com", email_verified: true }, db)).toMatchObject({ allow: false, reason: "no_sub" });
    expect(decideOidcLogin({ sub: "abc", email_verified: true }, db)).toMatchObject({ allow: false, reason: "no_email" });
  });
  it("a second identity with the same email can't take over a bound account", () => {
    expect(decideOidcLogin({ sub: "other", email: "me@example.com", email_verified: true }, dbWith({ ...me, oidc_sub: "abc" })))
      .toMatchObject({ allow: false, reason: "bound_to_other_identity" });
  });
});
