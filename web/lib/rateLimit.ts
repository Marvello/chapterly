// In-memory sliding window per key. ponytail: single web process; move to the DB if we ever run replicas.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, at = Date.now()): boolean => {
    if (hits.size > 10_000) hits.clear(); // bound memory against many distinct IPs
    const recent = (hits.get(key) ?? []).filter(t => at - t < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    return allowed;
  };
}
