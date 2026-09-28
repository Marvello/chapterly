export function readAuthConfig(): void {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
}
