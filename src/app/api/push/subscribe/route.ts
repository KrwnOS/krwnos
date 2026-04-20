import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticateCli, CliAuthError } from "@/app/api/cli/auth";
import { pushCliLookup } from "@/app/api/push/_cli";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/rate-limit";
import { rejectIfCrossSiteMutation } from "@/lib/same-origin-mutation";
// Side-effect: register push fan-out on the process Event Bus before any emit.
import "@/server/push-boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const postBody = z.object({
  subscription: subscriptionSchema,
  prefs: z
    .object({
      notifyDirectiveAcks: z.boolean().optional(),
      notifyProposalVotes: z.boolean().optional(),
    })
    .optional(),
});

const deleteBody = z.object({
  endpoint: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_push_subscribe");
  if (limited) return limited;

  const csrf = rejectIfCrossSiteMutation(req);
  if (csrf) return csrf;

  let cli;
  try {
    cli = await authenticateCli(req, pushCliLookup);
  } catch (e) {
    if (e instanceof CliAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
  if (!cli.stateId) {
    return NextResponse.json(
      { error: "Token is not scoped to any State.", code: "invalid_input" },
      { status: 400 },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON body.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", code: "invalid_input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { subscription: sub, prefs } = parsed.data;
  const notifyDirectiveAcks = prefs?.notifyDirectiveAcks ?? true;
  const notifyProposalVotes = prefs?.notifyProposalVotes ?? true;

  const subJson = sub as unknown as Prisma.InputJsonValue;

  await prisma.webPushSubscription.upsert({
    where: {
      userId_endpoint: {
        userId: cli.userId,
        endpoint: sub.endpoint,
      },
    },
    create: {
      userId: cli.userId,
      stateId: cli.stateId,
      endpoint: sub.endpoint,
      subscription: subJson,
      notifyDirectiveAcks,
      notifyProposalVotes,
    },
    update: {
      stateId: cli.stateId,
      subscription: subJson,
      notifyDirectiveAcks,
      notifyProposalVotes,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      stateId: cli.stateId,
      notifyDirectiveAcks,
      notifyProposalVotes,
    },
    { status: 200 },
  );
}

export async function DELETE(req: NextRequest) {
  const limited = await rateLimitedResponse(req, "api_push_unsubscribe");
  if (limited) return limited;

  const csrf = rejectIfCrossSiteMutation(req);
  if (csrf) return csrf;

  let cli;
  try {
    cli = await authenticateCli(req, pushCliLookup);
  } catch (e) {
    if (e instanceof CliAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON body with `endpoint`.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = deleteBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", code: "invalid_input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const res = await prisma.webPushSubscription.deleteMany({
    where: {
      userId: cli.userId,
      endpoint: parsed.data.endpoint,
    },
  });

  return NextResponse.json(
    { ok: true, removed: res.count > 0 },
    { status: 200 },
  );
}
