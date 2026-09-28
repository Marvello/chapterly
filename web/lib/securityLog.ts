// One JSON line per security event (common-tech security.md #18). Never pass passwords or tokens.
export type SecurityLog = (event: string, fields?: Record<string, unknown>) => void;

export const securityLog: SecurityLog = (event, fields = {}) =>
  console.log(JSON.stringify({ type: "security", event, ...fields, at: new Date().toISOString() }));
