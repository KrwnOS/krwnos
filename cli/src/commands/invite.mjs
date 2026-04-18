import { parseArgs } from "node:util";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function inviteCommand(argv, config) {
  const { values } = parseArgs({
    args: argv,
    options: {
      node: { type: "string" },
      label: { type: "string" },
      "max-uses": { type: "string", default: "1" },
      ttl: { type: "string" },
    },
    strict: true,
  });

  const profile = requireProfile(config);

  const ttlMs = values.ttl ? parseTtl(values.ttl) : undefined;
  const maxUses = Number.parseInt(values["max-uses"], 10);
  if (!Number.isFinite(maxUses) || maxUses < 1) {
    throw new Error("`--max-uses` must be a positive integer.");
  }

  const res = await call(profile, "/api/cli/invite", {
    method: "POST",
    body: {
      targetNodeId: values.node ?? null,
      label: values.label,
      maxUses,
      ttlMs,
    },
  });

  process.stdout.write(
    [
      `\x1b[33m✦ Invitation issued\x1b[0m`,
      `  code:  ${res.invitation.code}`,
      `  uses:  ${res.invitation.usesCount}/${res.invitation.maxUses}`,
      res.invitation.expiresAt
        ? `  exp:   ${res.invitation.expiresAt}`
        : `  exp:   never`,
      ``,
      `\x1b[1mShare this link once — it is never shown again:\x1b[0m`,
      `  ${res.url}`,
      ``,
    ].join("\n"),
  );
}

/** Parse "7d", "12h", "30m", "3600s" or plain milliseconds. */
function parseTtl(input) {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid --ttl: ${input}`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  const mul = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mul;
}
