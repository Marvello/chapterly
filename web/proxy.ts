import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { PUBLIC_PATHS, proxyDecision } from "@/lib/proxyRules";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(p => path === p || path.startsWith(`${p}/`));
  const decision = proxyDecision(path, isPublic || !!(await auth()));
  if (decision === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (decision === "login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
