import { NextResponse, type NextRequest } from "next/server";

/**
 * Blocks cross-site POST/PUT/PATCH/DELETE that rely on the browser’s ambient
 * credentials (session cookies) or abuse unauthenticated JSON endpoints from
 * another origin. See `docs/ARCHITECTURE.md` §CSRF.
 *
 * CLI and automation should send `Authorization: Bearer …` (then this check is
 * skipped), or send `Origin` / `Referer` matching `req.nextUrl.origin`.
 */
export function rejectIfCrossSiteMutation(req: NextRequest): NextResponse | null {
  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ") && auth.length > "bearer ".length) {
    return null;
  }

  const expected = req.nextUrl.origin;

  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== expected) {
      return NextResponse.json({ error: "cross_site_origin" }, { status: 403 });
    }
    return null;
  }

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) {
        return NextResponse.json({ error: "cross_site_referer" }, { status: 403 });
      }
      return null;
    } catch {
      return NextResponse.json({ error: "invalid_referer" }, { status: 403 });
    }
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return NextResponse.json({ error: "cross_site_fetch" }, { status: 403 });
  }
  if (
    secFetchSite === "same-origin" ||
    secFetchSite === "same-site" ||
    secFetchSite === "none"
  ) {
    return null;
  }

  return NextResponse.json(
    {
      error: "missing_origin",
      message:
        "For non-Bearer requests, send Origin or Referer matching this host (same as a browser), or use Authorization: Bearer for API clients.",
    },
    { status: 403 },
  );
}
