import bcrypt from "bcryptjs";
import type { Db } from "./db";
import { isLocked, lockUntil } from "./lockout";
import type { SecurityLog } from "./securityLog";

export interface LoginDeps {
  db: Pick<Db, "getUserByEmail" | "recordLoginFailure" | "recordLoginSuccess">;
  log: SecurityLog;
  allowIp: (ip: string) => boolean;
  now?: () => number;
}

let dummyHash: string | undefined;
// Same cost as real hashes, so "unknown email" takes as long as "wrong password" (security.md #5).
const getDummyHash = () =>
  (dummyHash ??= bcrypt.hashSync("dummy-password-for-equal-timing", Number(process.env.BCRYPT_ROUNDS || 12)));

/** Every failure returns null; the caller shows one generic message. */
export async function verifyPasswordLogin(email: unknown, password: unknown, ip: string, deps: LoginDeps) {
  const now = deps.now?.() ?? Date.now();
  if (typeof email !== "string" || typeof password !== "string" || email.length > 320 || password.length > 1024) {
    return null;
  }
  if (!deps.allowIp(ip)) {
    deps.log("login_rate_limited", { email, ip });
    return null;
  }
  const user = deps.db.getUserByEmail(email);
  const ok = await bcrypt.compare(password, user?.password_hash ?? getDummyHash());
  if (!user) {
    deps.log("login_failed", { email, ip, reason: "unknown_user" });
    return null;
  }
  if (isLocked(user.locked_until, now)) {
    deps.log("login_failed", { email: user.email, ip, reason: "locked" });
    return null;
  }
  if (!ok) {
    const until = lockUntil(user.failed_logins + 1, now);
    deps.db.recordLoginFailure(user.id, until);
    deps.log(until ? "account_locked" : "login_failed", { email: user.email, ip, reason: "bad_password", locked_until: until });
    return null;
  }
  deps.db.recordLoginSuccess(user.id);
  deps.log("login_success", { email: user.email, ip, method: "password" });
  return { id: String(user.id), email: user.email, name: user.name };
}
