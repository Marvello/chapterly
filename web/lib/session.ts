import type { Db, UserRow } from "./db";

/** A JWT is valid only while its user exists and its session_version matches (security.md #3). */
export function checkSession(token: { uid?: unknown; sv?: unknown }, db: Pick<Db, "getUserById">): UserRow | null {
  if (typeof token.uid !== "number" || typeof token.sv !== "number") return null;
  const user = db.getUserById(token.uid);
  return user && user.session_version === token.sv ? user : null;
}
