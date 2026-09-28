import type { Db } from "./db";

export type OidcDecision =
  | { allow: true; userId: number; bind: boolean }
  | { allow: false; reason: "no_sub" | "no_email" | "email_not_verified" | "unknown_email" | "bound_to_other_identity" };

/**
 * Map an OIDC identity to the single local account. Never creates users.
 * 1) bound sub → allow; 2) verified email of an unbound user → allow + bind; 3) otherwise reject.
 */
export function decideOidcLogin(
  profile: { sub?: unknown; email?: unknown; email_verified?: unknown },
  db: Pick<Db, "getUserByOidcSub" | "getUserByEmail">,
): OidcDecision {
  if (typeof profile.sub !== "string" || !profile.sub) return { allow: false, reason: "no_sub" };
  const bound = db.getUserByOidcSub(profile.sub);
  if (bound) return { allow: true, userId: bound.id, bind: false };
  if (typeof profile.email !== "string" || !profile.email) return { allow: false, reason: "no_email" };
  if (profile.email_verified !== true) return { allow: false, reason: "email_not_verified" };
  const user = db.getUserByEmail(profile.email);
  if (!user) return { allow: false, reason: "unknown_email" };
  if (user.oidc_sub) return { allow: false, reason: "bound_to_other_identity" };
  return { allow: true, userId: user.id, bind: true };
}
