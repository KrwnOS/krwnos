import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateKrwnModuleManifest, signKrwnPackage, verifyKrwnPackage } from "@krwnos/sdk";
import { requireProfile } from "../config.mjs";
import { call } from "../http.mjs";

export async function moduleCommand(argv, config) {
  const [sub, ...rest] = argv;

  switch (sub) {
    case "install":
      return install(rest, config);
    case "list":
      return list(requireProfile(config));
    case "validate":
      return validateManifest(rest);
    case "uninstall":
      return uninstall(rest, requireProfile(config));
    case "sign":
      return sign(rest);
    case "verify":
      return verify(rest);
    default:
      throw new Error(
        `Unknown module sub-command: "${sub ?? ""}". Expected: install | list | validate | uninstall | sign | verify.`,
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
  process.stdout.write(`\u2713 ${path} \u2014 ${r.manifest.slug}@${r.manifest.version}\n`);
}

async function install(argv, config) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      "trusted-key": { type: "string", multiple: true },
    },
    strict: true,
  });

  const target = positionals[0];
  if (!target) throw new Error("Usage: krwn module install <slug> | <file.krwn>");

  // Local `.krwn` install: verify locally, then POST manifest to the
  // existing `/api/cli/modules` endpoint (task-brief option "a").
  if (target.toLowerCase().endsWith(".krwn")) {
    const filePath = resolve(target);
    const stat = statSync(filePath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) {
      throw new Error(`Not a file: ${target}`);
    }

    const trustedKeys = loadTrustedKeys(values["trusted-key"]);
    if (trustedKeys.length === 0) {
      throw new Error(
        "No trusted publisher keys configured. Pass --trusted-key <file.pem> " +
          "(repeatable) or set KRWN_TRUSTED_MODULE_PUBKEYS.",
      );
    }

    const verifyResult = await verifyKrwnPackage(filePath, { trustedKeys });
    if (!verifyResult.ok) {
      throw new Error(
        `Package verification failed: ${verifyResult.reason}${verifyResult.details ? ` (${verifyResult.details})` : ""}`,
      );
    }

    const profile = requireProfile(config);
    const res = await call(profile, "/api/cli/modules", {
      method: "POST",
      body: {
        slug: verifyResult.manifest.slug,
        version: values.version ?? verifyResult.manifest.version,
        manifest: verifyResult.manifest,
      },
    });
    process.stdout.write(
      `\u2713 installed ${res.installed.slug}@${res.installed.version} ` +
        `(signer ${verifyResult.signer.id} \u2014 ${verifyResult.signer.publicKeyFingerprint})\n`,
    );
    return;
  }

  // Slug-based registry install (unchanged).
  const profile = requireProfile(config);
  const res = await call(profile, "/api/cli/modules", {
    method: "POST",
    body: { slug: target, version: values.version },
  });
  process.stdout.write(`\u2713 installed ${target}@${res.installed.version}\n`);
}

async function list(profile) {
  const res = await call(profile, "/api/cli/modules");
  if (!res.installed.length) {
    process.stdout.write("(no modules installed)\n");
    return;
  }
  for (const m of res.installed) {
    const flag = m.enabled ? "\u25CF" : "\u25CB";
    process.stdout.write(`${flag} ${m.slug}@${m.version}\n`);
  }
}

async function uninstall(argv, _profile) {
  void argv;
  throw new Error("`module uninstall` is not yet implemented.");
}

async function sign(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      key: { type: "string" },
      out: { type: "string" },
      publisher: { type: "string" },
    },
    strict: true,
  });

  const dir = positionals[0];
  if (!dir) throw new Error("Usage: krwn module sign <dir> --key <privkey.pem> --out <file.krwn> [--publisher <id>]");
  if (!values.key) throw new Error("--key <privkey.pem> is required");
  if (!values.out) throw new Error("--out <file.krwn> is required");

  const keyPem = readFileSync(values.key, "utf8");
  const publisherId = values.publisher || "krwnos.local";
  const res = await signKrwnPackage({
    sourceDir: dir,
    outFile: values.out,
    privateKeyPem: keyPem,
    publisherId,
  });
  process.stdout.write(
    `\u2713 signed ${values.out}\n` +
      `  publisher:    ${publisherId}\n` +
      `  fingerprint:  ${res.publicKeyFingerprint}\n` +
      `  contentHash:  ${res.contentHash}\n`,
  );
}

async function verify(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "trusted-key": { type: "string", multiple: true },
    },
    strict: true,
  });

  const filePath = positionals[0];
  if (!filePath) {
    throw new Error(
      "Usage: krwn module verify <file.krwn> [--trusted-key <pubkey.pem>]...",
    );
  }

  const trustedKeys = loadTrustedKeys(values["trusted-key"]);
  if (trustedKeys.length === 0) {
    throw new Error(
      "No trusted publisher keys configured. Pass --trusted-key <file.pem> " +
        "(repeatable) or set KRWN_TRUSTED_MODULE_PUBKEYS.",
    );
  }

  const result = await verifyKrwnPackage(resolve(filePath), { trustedKeys });
  if (!result.ok) {
    process.stderr.write(
      `\u2717 verify failed: ${result.reason}${result.details ? ` (${result.details})` : ""}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `\u2713 ${filePath} verified\n` +
      `  manifest:     ${result.manifest.slug}@${result.manifest.version}\n` +
      `  signer:       ${result.signer.id}\n` +
      `  fingerprint:  ${result.signer.publicKeyFingerprint}\n` +
      `  contentHash:  ${result.contentHash}\n` +
      `  permissions:  ${result.manifest.permissions.join(", ")}\n`,
  );
}

function loadTrustedKeys(cliFlags) {
  const keys = [];
  const envRaw = process.env.KRWN_TRUSTED_MODULE_PUBKEYS;
  const envPaths = envRaw ? envRaw.split(/[:\n]/).map((s) => s.trim()).filter(Boolean) : [];
  const flagPaths = Array.isArray(cliFlags) ? cliFlags : [];

  for (const rawPath of [...envPaths, ...flagPaths]) {
    const abs = resolve(rawPath);
    let pem;
    try {
      pem = readFileSync(abs, "utf8");
    } catch (e) {
      throw new Error(`trusted key ${rawPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const last = abs.replace(/\\/g, "/").split("/").pop() ?? abs;
    const id = last.replace(/\.(pem|pub)$/i, "");
    keys.push({ id, publicKeyPem: pem });
  }
  return keys;
}
