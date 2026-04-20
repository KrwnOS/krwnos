/**
 * BullMQ task: email digest (daily / weekly).
 *
 * Opt-in:
 *   - Instance: `KRWN_EMAIL_DIGEST_ENABLED=1`
 *   - User: `User.emailDigestDaily` / `emailDigestWeekly` (and `email` set)
 *
 * Dry-run: default in `NODE_ENV=development` unless `KRWN_EMAIL_DIGEST_DRY_RUN=0`.
 * Skips SMTP and idempotency inserts; logs intended recipients.
 *
 * Idempotency: `EmailDigestSend` unique `(userId, kind, periodKey)` — claim row
 * before send; remove row if SMTP throws so the next cron can retry.
 */

import { Prisma } from "@prisma/client";
import {
  createSmtpTransport,
  readSmtpEnv,
  sendMagicEmail,
} from "@/core/magic-email-smtp";
import { prisma } from "@/lib/prisma";
import { aggregateDigestForUser } from "./email-digest-aggregate";
import type { DigestKind } from "./email-digest-period";
import { digestPeriodKey } from "./email-digest-period";
import { renderDigestEmail, renderDigestSubject } from "./email-digest-templates";

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export function isEmailDigestDryRun(): boolean {
  const raw = process.env.KRWN_EMAIL_DIGEST_DRY_RUN?.trim();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return process.env.NODE_ENV === "development";
}

function digestEnabled(): boolean {
  return process.env.KRWN_EMAIL_DIGEST_ENABLED?.trim() === "1";
}

function authBaseUrl(): string {
  return (
    process.env.AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  );
}

export async function runEmailDigestJob(opts: {
  kind: DigestKind;
  /** Test hook */
  now?: Date;
}): Promise<{
  kind: DigestKind;
  skipped?: "disabled" | "no_smtp" | "dry_run_config";
  periodKey: string;
  sent: number;
  skippedUsers: number;
  dryRun: boolean;
}> {
  const now = opts.now ?? new Date();
  const dryRun = isEmailDigestDryRun();
  const dailyTz =
    process.env.KRWN_JOB_EMAIL_DIGEST_DAILY_TZ?.trim() || "UTC";

  if (!dryRun && !digestEnabled()) {
    return {
      kind: opts.kind,
      skipped: "disabled",
      periodKey: digestPeriodKey(opts.kind, now, dailyTz),
      sent: 0,
      skippedUsers: 0,
      dryRun: false,
    };
  }

  const smtp = readSmtpEnv();
  if (!dryRun && !smtp) {
    return {
      kind: opts.kind,
      skipped: "no_smtp",
      periodKey: digestPeriodKey(opts.kind, now, dailyTz),
      sent: 0,
      skippedUsers: 0,
      dryRun: false,
    };
  }

  const periodKey = digestPeriodKey(opts.kind, now, dailyTz);
  const transport = smtp ? createSmtpTransport(smtp) : null;
  const defaultFrom = smtp?.from;

  const wantDaily = opts.kind === "daily";
  const users = await prisma.user.findMany({
    where: {
      email: { not: null },
      ...(wantDaily ? { emailDigestDaily: true } : { emailDigestWeekly: true }),
    },
    select: {
      id: true,
      email: true,
      handle: true,
      emailDigestDaily: true,
      emailDigestWeekly: true,
      emailDigestChatMentions: true,
    },
  });

  let sent = 0;
  let skippedUsers = 0;

  for (const u of users) {
    if (!u.email) continue;

    const already = await prisma.emailDigestSend.findUnique({
      where: {
        userId_kind_periodKey: {
          userId: u.id,
          kind: opts.kind,
          periodKey,
        },
      },
      select: { id: true },
    });
    if (already) {
      skippedUsers += 1;
      continue;
    }

    const aggregates = await aggregateDigestForUser(prisma, {
      userId: u.id,
      handle: u.handle,
      kind: opts.kind,
      now,
      includeChatMentions: u.emailDigestChatMentions,
    });

    const membership = await prisma.membership.findFirst({
      where: { userId: u.id, status: "active" },
      select: { node: { select: { state: { select: { slug: true, name: true } } } } },
    });
    const stateSlug = membership?.node.state?.slug ?? null;
    const stateName = membership?.node.state?.name ?? null;

    const { text, html } = renderDigestEmail({
      aggregates,
      baseUrl: authBaseUrl(),
      stateSlug,
    });
    const subject = renderDigestSubject(opts.kind, stateName);

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[email-digest] dry-run ${opts.kind} period=${periodKey} → ${u.email} (${u.handle})`,
      );
      sent += 1;
      continue;
    }

    let claimedId: string | null = null;
    try {
      const row = await prisma.emailDigestSend.create({
        data: { userId: u.id, kind: opts.kind, periodKey },
        select: { id: true },
      });
      claimedId = row.id;
    } catch (e) {
      if (isUniqueViolation(e)) {
        skippedUsers += 1;
        continue;
      }
      throw e;
    }

    try {
      if (!transport || !defaultFrom) {
        throw new Error("SMTP transport unavailable after dry-run check");
      }
      await sendMagicEmail(
        transport,
        {
          to: u.email,
          subject,
          text,
          html,
          from: defaultFrom,
        },
        { defaultFrom },
      );
      sent += 1;
    } catch (err) {
      if (claimedId) {
        await prisma.emailDigestSend.delete({ where: { id: claimedId } });
      }
      throw err;
    }
  }

  return { kind: opts.kind, periodKey, sent, skippedUsers, dryRun };
}
