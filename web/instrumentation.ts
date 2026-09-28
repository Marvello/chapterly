// Runs once when the server starts (not at build). Node-only work lives in instrumentation-node.ts
// so the Edge compile of this file never sees Node APIs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
