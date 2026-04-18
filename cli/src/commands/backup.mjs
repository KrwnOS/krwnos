import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function backupCommand(argv, config) {
  const [maybeSub, ...rest] = argv;
  const profile = requireProfile(config);

  if (maybeSub === "list") {
    return list(profile);
  }

  return create([maybeSub, ...rest].filter(Boolean), profile);
}

async function create(argv, profile) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: "string" },
    },
    strict: true,
  });

  const res = await call(profile, "/api/cli/backup", { method: "POST" });

  const outPath = resolve(
    process.cwd(),
    values.out ?? `krwn-backup-${Date.now()}.json`,
  );
  await writeFile(outPath, JSON.stringify(res.payload, null, 2), "utf8");

  process.stdout.write(
    [
      `\x1b[32m✓ Backup created\x1b[0m`,
      `  file:     ${outPath}`,
      `  size:     ${res.sizeBytes} bytes`,
      `  sha256:   ${res.checksum}`,
      ``,
    ].join("\n"),
  );
}

async function list(profile) {
  const res = await call(profile, "/api/cli/backup");
  if (!res.backups.length) {
    process.stdout.write("(no backups)\n");
    return;
  }
  for (const b of res.backups) {
    process.stdout.write(
      `${b.createdAt}  ${b.sizeBytes.padStart(10)}B  ${b.checksum?.slice(0, 12) ?? "-"}  ${b.id}\n`,
    );
  }
}
