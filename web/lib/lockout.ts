// Login lockout with exponential backoff (common-tech security.md #17, retry-backoff.md pattern).
export const MAX_FAILED = 5;

/** Lock expiry after `failedLogins` consecutive failures (count including this one), or null. */
export function lockUntil(failedLogins: number, at = Date.now()): string | null {
  if (failedLogins < MAX_FAILED) return null;
  const minutes = Math.min(60, 2 ** (failedLogins - MAX_FAILED));
  return new Date(at + minutes * 60_000).toISOString();
}

export const isLocked = (lockedUntil: string | null, at = Date.now()) =>
  !!lockedUntil && Date.parse(lockedUntil) > at;
