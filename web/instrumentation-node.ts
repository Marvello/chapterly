// Startup check: validate auth env and open the DB (applies pending migrations).
// Any failure stops the server instead of serving half-configured.
import { readAuthConfig } from "./lib/authConfig";
import { getDb } from "./lib/db";

try {
  readAuthConfig();
  getDb();
} catch (e) {
  console.error("startup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
