/**
 * Tests for `.krwn` package signing / verification.
 *
 * Exercise every documented failure mode — these failure codes are the
 * contract the CLI (and a future Marketplace) rely on, so each one gets
 * its own case.
 */

import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  KRWN_PACKAGE_MANIFEST_PATH,
  KRWN_PACKAGE_SIGNATURE_PATH,
  fingerprintEd25519PublicKeyPem,
  signKrwnPackage,
  tarPack,
  tarUnpack,
  verifyKrwnPackage,
} from "./sign.js";

// -----------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------

function mkKeyPair(): { privateKeyPem: string; publicKeyPem: string; fingerprint: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }) as string;
  return {
    privateKeyPem,
    publicKeyPem,
    fingerprint: fingerprintEd25519PublicKeyPem(publicKeyPem),
  };
}

function mkTempDir(): string {
  return mkdtempSync(join(tmpdir(), "krwn-sign-"));
}

function mkValidSourceDir(dir: string): void {
  const manifest = {
    $schema: "https://krwnos.com/schemas/krwn-module-manifest.json",
    slug: "test.example",
    version: "1.2.3",
    permissions: ["test.example.read"],
    migrations: "prisma/migrations",
    peerDeps: { "@krwnos/sdk": "^0.1.0" },
    ui: "src/ui/index.tsx",
    schemaName: "krwn_test_example",
  };
  writeFileSync(join(dir, "krwn.module.json"), JSON.stringify(manifest, null, 2));
  // Populate `module/` so there is a real source tree to hash.
  const modDir = join(dir, "module");
  mkdirSync(join(modDir, "src"), { recursive: true });
  writeFileSync(join(modDir, "src", "index.ts"), "export const hello = 'world';\n");
  writeFileSync(join(modDir, "README.md"), "# test.example\n");
}

/**
 * Round-trip a `.krwn` file through a mutation closure: gunzip → tar
 * unpack → mutate → tar pack → gzip → write. Lets tests simulate
 * tampering without re-running sign logic.
 */
function rewritePackage(
  filePath: string,
  mutate: (entries: Map<string, Uint8Array>) => void,
): void {
  const gz = readFileSync(filePath);
  const tar = gunzipSync(gz);
  const entries = tarUnpack(tar);
  mutate(entries);
  const rebuilt = tarPack(entries);
  writeFileSync(filePath, gzipSync(rebuilt));
}

// -----------------------------------------------------------------
// Cases
// -----------------------------------------------------------------

describe("signKrwnPackage + verifyKrwnPackage", () => {
  it("round-trips a valid package", async () => {
    const key = mkKeyPair();
    const src = mkTempDir();
    mkValidSourceDir(src);
    const out = join(mkTempDir(), "example.krwn");

    const signed = await signKrwnPackage({
      sourceDir: src,
      outFile: out,
      privateKeyPem: key.privateKeyPem,
      publisherId: "krwnos.test",
    });

    expect(signed.publicKeyFingerprint).toBe(key.fingerprint);
    expect(signed.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const result = await verifyKrwnPackage(out, {
      trustedKeys: [{ id: "krwnos.test", publicKeyPem: key.publicKeyPem }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.slug).toBe("test.example");
    expect(result.manifest.version).toBe("1.2.3");
    expect(result.signer.publicKeyFingerprint).toBe(key.fingerprint);
    expect(result.contentHash).toBe(signed.contentHash);
  });

  it("reports tampered_payload when a file byte changes after signing", async () => {
    const key = mkKeyPair();
    const src = mkTempDir();
    mkValidSourceDir(src);
    const out = join(mkTempDir(), "tampered.krwn");
    await signKrwnPackage({
      sourceDir: src,
      outFile: out,
      privateKeyPem: key.privateKeyPem,
      publisherId: "krwnos.test",
    });

    rewritePackage(out, (entries) => {
      const path = "module/src/index.ts";
      const original = entries.get(path);
      if (!original) throw new Error("fixture missing module file");
      const mutated = Buffer.from(original);
      mutated[0] = (mutated[0] ?? 0) ^ 0x01;
      entries.set(path, mutated);
    });

    const result = await verifyKrwnPackage(out, {
      trustedKeys: [{ id: "krwnos.test", publicKeyPem: key.publicKeyPem }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("tampered_payload");
  });

  it("reports signature_mismatch when signature bytes are swapped", async () => {
    // Victim and attacker each sign their own package. The attacker's
    // signature is injected into the victim's SIGNATURE file. The
    // content hash stays valid (payload unchanged), fingerprint still
    // points at the victim's trusted key, but the signature bytes fail
    // verification.
    const victim = mkKeyPair();
    const attacker = mkKeyPair();

    const victimSrc = mkTempDir();
    mkValidSourceDir(victimSrc);
    const victimOut = join(mkTempDir(), "victim.krwn");
    await signKrwnPackage({
      sourceDir: victimSrc,
      outFile: victimOut,
      privateKeyPem: victim.privateKeyPem,
      publisherId: "krwnos.test",
    });

    const attackerSrc = mkTempDir();
    mkValidSourceDir(attackerSrc);
    const attackerOut = join(mkTempDir(), "attacker.krwn");
    await signKrwnPackage({
      sourceDir: attackerSrc,
      outFile: attackerOut,
      privateKeyPem: attacker.privateKeyPem,
      publisherId: "krwnos.attacker",
    });

    const attackerEntries = tarUnpack(gunzipSync(readFileSync(attackerOut)));
    const attackerSigRaw = attackerEntries.get(KRWN_PACKAGE_SIGNATURE_PATH);
    if (!attackerSigRaw) throw new Error("attacker package missing SIGNATURE");
    const attackerSig = JSON.parse(Buffer.from(attackerSigRaw).toString("utf8"));

    rewritePackage(victimOut, (entries) => {
      const raw = entries.get(KRWN_PACKAGE_SIGNATURE_PATH);
      if (!raw) throw new Error("SIGNATURE missing from victim");
      const parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
      parsed.signature = attackerSig.signature; // swap only the signature bytes
      entries.set(
        KRWN_PACKAGE_SIGNATURE_PATH,
        Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8"),
      );
    });

    const result = await verifyKrwnPackage(victimOut, {
      trustedKeys: [{ id: "krwnos.test", publicKeyPem: victim.publicKeyPem }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("signature_mismatch");
  });

  it("reports untrusted_signer when the fingerprint is not in trustedKeys", async () => {
    const signer = mkKeyPair();
    const unrelated = mkKeyPair();
    const src = mkTempDir();
    mkValidSourceDir(src);
    const out = join(mkTempDir(), "untrusted.krwn");
    await signKrwnPackage({
      sourceDir: src,
      outFile: out,
      privateKeyPem: signer.privateKeyPem,
      publisherId: "krwnos.test",
    });

    const result = await verifyKrwnPackage(out, {
      trustedKeys: [{ id: "someone-else", publicKeyPem: unrelated.publicKeyPem }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("untrusted_signer");
  });

  it("reports manifest_invalid when a signed package carries a bad manifest", async () => {
    // A malformed manifest inside an otherwise-valid tarball is a
    // publisher bug we still want to surface with a specific reason —
    // the CLI renders this differently from "tampered_payload".
    const key = mkKeyPair();
    const src = mkTempDir();
    mkValidSourceDir(src);
    const out = join(mkTempDir(), "bad-manifest.krwn");
    await signKrwnPackage({
      sourceDir: src,
      outFile: out,
      privateKeyPem: key.privateKeyPem,
      publisherId: "krwnos.test",
    });

    rewritePackage(out, (entries) => {
      const badManifest = {
        slug: "Bad_Slug_With_Underscores",
        version: "not-semver",
        permissions: ["nope"],
        migrations: "m",
        peerDeps: {},
        ui: "u",
        schemaName: "krwn_x",
      };
      entries.set(
        KRWN_PACKAGE_MANIFEST_PATH,
        Buffer.from(JSON.stringify(badManifest, null, 2), "utf8"),
      );
    });

    const result = await verifyKrwnPackage(out, {
      trustedKeys: [{ id: "krwnos.test", publicKeyPem: key.publicKeyPem }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("manifest_invalid");
  });

  it("reports invalid_archive for a gzipped blob that is not a tar stream", async () => {
    const key = mkKeyPair();
    const out = join(mkTempDir(), "garbage.krwn");
    writeFileSync(out, gzipSync(Buffer.from("not a tar", "utf8")));

    const result = await verifyKrwnPackage(out, {
      trustedKeys: [{ id: "krwnos.test", publicKeyPem: key.publicKeyPem }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_archive");
  });
});
