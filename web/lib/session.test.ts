import { expect, it } from "vitest";
import type { UserRow } from "./db";
import { checkSession } from "./session";

const me: UserRow = { id: 1, name: null, email: "me@example.com", password_hash: "h", failed_logins: 0,
  locked_until: null, session_version: 2, oidc_sub: null, created_at: "" };
const db = { getUserById: (id: number) => (id === 1 ? me : undefined) };

it("current session_version → user; stale, deleted or malformed → null", () => {
  expect(checkSession({ uid: 1, sv: 2 }, db)).toBe(me);
  expect(checkSession({ uid: 1, sv: 1 }, db)).toBeNull();   // password changed via CLI
  expect(checkSession({ uid: 9, sv: 2 }, db)).toBeNull();
  expect(checkSession({ uid: "1", sv: 2 }, db)).toBeNull();
  expect(checkSession({}, db)).toBeNull();
});
