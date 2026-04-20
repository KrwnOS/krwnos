import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/push/subscribe
 *
 * Scaffold for Web Push subscription storage. Browsers need VAPID keys
 * (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`); persisting
 * `PushSubscription` JSON and sending notifications is not implemented yet
 * — see `docs/ROADMAP.md` (Horizon 2 · web-push).
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON body.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const sub =
    body &&
    typeof body === "object" &&
    "subscription" in body &&
    (body as { subscription?: unknown }).subscription;

  if (!sub || typeof sub !== "object") {
    return NextResponse.json(
      {
        error:
          "Body must include a `subscription` object (PushSubscription JSON).",
        code: "invalid_input",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      stub: true,
      message:
        "Subscription accepted for development only; not persisted. Web Push delivery is planned in Horizon 2.",
    },
    { status: 202 },
  );
}
