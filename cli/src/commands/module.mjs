import { parseArgs } from "node:util";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function moduleCommand(argv, config) {
  const [sub, ...rest] = argv;
  const profile = requireProfile(config);

  switch (sub) {
    case "install":
      return install(rest, profile);
    case "list":
      return list(profile);
    case "uninstall":
      return uninstall(rest, profile);
    default:
      throw new Error(
        `Unknown module sub-command: "${sub ?? ""}". Expected: install | list | uninstall.`,
      );
  }
}

async function install(argv, profile) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
    },
    strict: true,
  });

  const slug = positionals[0];
  if (!slug) throw new Error("Usage: krwn module install <slug>");

  const res = await call(profile, "/api/cli/modules", {
    method: "POST",
    body: { slug, version: values.version },
  });
  process.stdout.write(`✓ installed ${slug}@${res.installed.version}\n`);
}

async function list(profile) {
  const res = await call(profile, "/api/cli/modules");
  if (!res.installed.length) {
    process.stdout.write("(no modules installed)\n");
    return;
  }
  for (const m of res.installed) {
    const flag = m.enabled ? "●" : "○";
    process.stdout.write(`${flag} ${m.slug}@${m.version}\n`);
  }
}

async function uninstall(argv, _profile) {
  void argv;
  throw new Error("`module uninstall` is not yet implemented.");
}
