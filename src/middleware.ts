import { NextResponse, type NextRequest } from "next/server";

/**
 * Propagates `x-request-id` for correlation (pino child loggers in Route Handlers).
 * CSP and other security headers are set in `next.config.mjs`.
 * CSRF / cross-site POST policy for public routes: `src/lib/same-origin-mutation.ts`
 * (see `docs/ARCHITECTURE.md` §7).
 */
export function middleware(request: NextRequest) {
  const existing =
    request.headers.get("x-request-id") ??
    request.headers.get("X-Request-Id");
  const requestId = existing?.trim() || crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
