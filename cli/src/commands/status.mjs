import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function statusCommand(_argv, config) {
  const profile = requireProfile(config);
  try {
    const res = await call(profile, "/api/cli/status");
    process.stdout.write(
      [
        `host:     ${profile.host}`,
        `tier:     ${res.tier}`,
        `version:  ${res.version}`,
        `tunnel:   ${res.tunnel?.enabled ? `${res.tunnel.provider} → ${res.tunnel.publicUrl ?? "—"}` : "off"}`,
        ``,
      ].join("\n"),
    );
  } catch (err) {
    process.stdout.write(
      `host:     ${profile.host}\nstatus:   \x1b[31munreachable\x1b[0m (${err.message})\n`,
    );
  }
}
