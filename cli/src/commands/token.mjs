import { parseArgs } from "node:util";
import { requireProfile, saveConfig } from "../config.mjs";
import { call } from "../http.mjs";

export async function tokenCommand(argv, config) {
  const [sub, ...rest] = argv;
  const profile = requireProfile(config);

  switch (sub) {
    case "rotate":
      return rotate(rest, profile, config);
    default:
      throw new Error(
        `Unknown token sub-command: "${sub ?? ""}". Expected: rotate.`,
      );
  }
}

async function rotate(argv, profile, config) {
  const { values } = parseArgs({
    args: argv,
    options: {
      label: { type: "string" },
      ttl: { type: "string" },
      scopes: { type: "string" },
    },
    strict: true,
  });

  const body = {};
  if (values.label) body.label = values.label;
  if (values.scopes) body.scopes = values.scopes.split(",").map((s) => s.trim());
  if (values.ttl) body.ttlMs = parseTtl(values.ttl);

  const res = await call(profile, "/api/cli/tokens/rotate", {
    method: "POST",
    body,
  });

  // Persist the new token back into the active profile.
  const activeName = config.defaultProfile;
  const next = {
    ...config,
    profiles: {
      ...config.profiles,
      [activeName]: { ...profile, token: res.token },
    },
  };
  await saveConfig(next);

  process.stdout.write(
    [
      `\x1b[32m✓ Token rotated\x1b[0m`,
      `  revoked:  ${res.revokedTokenId}`,
      `  new id:   ${res.tokenId}`,
      `  label:    ${res.label}`,
      `  scopes:   ${res.scopes.join(", ")}`,
      res.expiresAt ? `  expires:  ${res.expiresAt}` : `  expires:  never`,
      ``,
      `  \x1b[90mProfile "${activeName}" обновлён автоматически.\x1b[0m`,
      ``,
    ].join("\n"),
  );
}

function parseTtl(input) {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid --ttl: ${input}`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms").toLowerCase();
  const mul = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mul;
}
