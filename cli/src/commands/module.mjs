import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateKrwnModuleManifest } from "@krwnos/sdk";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function moduleCommand(argv, config) {
  const [sub, ...rest] = argv;

  switch (sub) {
    case "install":
      return install(rest, requireProfile(config));
    case "list":
      return list(requireProfile(config));
    case "validate":
      return validateManifest(rest);
    case "uninstall":
      return uninstall(rest, requireProfile(config));
    default:
      throw new Error(
        `Unknown module sub-command: "${sub ?? ""}". Expected: install | list | validate | uninstall.`,
      );
  }
}

function resolveManifestFilePath(raw) {
  const abs = resolve(raw);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) throw new Error(`Not found: ${raw}`);
  if (st.isDirectory()) return resolve(abs, "krwn.module.json");
  return abs;
}

async function validateManifest(argv) {
  const { positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
  });
  const target = positionals[0];
  if (!target) throw new Error("Usage: krwn module validate <path-to-krwn.module.json-or-dir>");

  const path = resolveManifestFilePath(target);
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Failed to read JSON from ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const r = validateKrwnModuleManifest(json);
  if (!r.ok) {
    process.stderr.write(`Invalid krwn.module.json (${path}):\n`);
    for (const line of r.errors) process.stderr.write(`  - ${line}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`✓ ${path} — ${r.manifest.slug}@${r.manifest.version}\n`);
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
