import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { resolve, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import type { KrwnModuleManifest } from "./manifest.js";
import { validateKrwnModuleManifest } from "./manifest.js";

// Package format constants
export const KRWN_PACKAGE_FORMAT_VERSION = "1";
export const KRWN_PACKAGE_MANIFEST_PATH = "krwn.module.json";
export const KRWN_PACKAGE_SIGNATURE_PATH = "SIGNATURE";
export const KRWN_PACKAGE_MODULE_PREFIX = "module/";
export const KRWN_SIGNATURE_ALGORITHM = "Ed25519";
export const KRWN_SIGNATURE_DOMAIN = "krwn-package";
export const KRWN_CONTENT_HASH_ALGORITHM = "SHA256";

export type KrwnPackageVerifyReason =
  | "invalid_archive"
  | "manifest_invalid"
  | "signature_mismatch"
  | "untrusted_signer"
  | "tampered_payload";

export interface KrwnPackageSignatureFile {
  version: string;
  algorithm: string;
  signedAt: string;
  publisherId: string;
  publicKeyFingerprint: string;
  contentHash: string;
  signature: string;
}

export interface PublicKeyEntry {
  id: string;
  publicKeyPem: string;
}

export interface VerifiedSigner {
  id: string;
  publicKeyFingerprint: string;
}

export interface SignKrwnPackageInput {
  sourceDir: string;
  outFile: string;
  privateKeyPem: string;
  publisherId: string;
}

export interface SignKrwnPackageResult {
  publicKeyFingerprint: string;
  contentHash: string;
  signature: string;
}

export interface VerifyKrwnPackageResultSuccess {
  ok: true;
  manifest: KrwnModuleManifest;
  contentHash: string;
  signer: VerifiedSigner;
}

export interface VerifyKrwnPackageResultFailure {
  ok: false;
  reason: KrwnPackageVerifyReason;
  details?: string;
}

export type VerifyKrwnPackageResult = VerifyKrwnPackageResultSuccess | VerifyKrwnPackageResultFailure;

/**
 * Compute SHA256 fingerprint of an Ed25519 public key (PEM format).
 */
export function fingerprintEd25519PublicKeyPem(pubKeyPem: string): string {
  return createHash("sha256").update(pubKeyPem).digest("hex").slice(0, 16);
}

/**
 * Compute SHA256 content hash of package entries (excluding SIGNATURE).
 */
export function computeContentHash(entries: Map<string, Uint8Array>): Buffer {
  const hash = createHash("sha256");
  const sortedKeys = Array.from(entries.keys()).sort();
  for (const key of sortedKeys) {
    if (key !== KRWN_PACKAGE_SIGNATURE_PATH) {
      const data = entries.get(key);
      if (data) hash.update(data);
    }
  }
  return hash.digest();
}

/**
 * Pack tar entries into a tar buffer (no gzip).
 */
export function tarPack(entries: Map<string, Uint8Array>): Buffer {
  const chunks: Buffer[] = [];

  for (const [path, data] of entries) {
    const header = createTarHeader(path, data.length);
    chunks.push(Buffer.from(header));
    chunks.push(Buffer.from(data));

    const padLength = (512 - ((data.length % 512) || 512)) % 512;
    if (padLength > 0) {
      chunks.push(Buffer.alloc(padLength, 0));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

/**
 * Unpack a tar buffer into entries.
 */
export function tarUnpack(tarData: Buffer): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let offset = 0;

  while (offset < tarData.length) {
    if (offset + 1024 <= tarData.length) {
      const chunk = tarData.subarray(offset, offset + 1024);
      if (chunk.every((b) => b === 0)) {
        break;
      }
    }

    const headerBytes = tarData.subarray(offset, offset + 512);
    if (headerBytes.every((b) => b === 0)) break;

    const header = parseTarHeader(headerBytes);
    if (!header) break;

    offset += 512;

    const fileData = tarData.subarray(offset, offset + header.size);
    entries.set(header.path, fileData);

    const padLength = (512 - ((header.size % 512) || 512)) % 512;
    offset += header.size + padLength;
  }

  return entries;
}

/**
 * Read a .krwn package (gzipped tar) and return its entries.
 */
export async function readKrwnPackageSync(filePath: string): Promise<Map<string, Uint8Array>> {
  const gz = readFileSync(filePath);
  const tar = await new Promise<Buffer>((resolve, reject) => {
    const gunzip = createGunzip();
    let result = Buffer.alloc(0);
    gunzip.on("data", (chunk) => {
      result = Buffer.concat([result, chunk]);
    });
    gunzip.on("end", () => resolve(result));
    gunzip.on("error", reject);
    gunzip.end(gz);
  });
  return tarUnpack(tar);
}

/**
 * List all file paths in a tar package.
 */
export async function listFilesSync(filePath: string): Promise<string[]> {
  const entries = await readKrwnPackageSync(filePath);
  return Array.from(entries.keys()).sort();
}

// Helper functions for tar format

function createTarHeader(path: string, size: number): string {
  const lines: string[] = [];
  lines.push(path.padEnd(100, "\0"));
  lines.push("0000644\0".slice(0, 8));
  lines.push("0000000\0".slice(0, 8));
  lines.push("0000000\0".slice(0, 8));
  lines.push(sizeToOctal(size, 12));
  lines.push(timeToOctal(Math.floor(Date.now() / 1000), 12));
  lines.push("        ");
  lines.push("0");
  lines.push("\0".repeat(100));
  lines.push("ustar\0".padEnd(6, "\0"));
  lines.push("\0".repeat(32));
  lines.push("\0".repeat(32));
  lines.push("\0".repeat(8));
  lines.push("\0".repeat(8));
  lines.push("\0".repeat(155));

  const headerNoChecksum = lines.join("");
  const checksum = computeTarChecksum(Buffer.from(headerNoChecksum));
  const header = headerNoChecksum.slice(0, 148) + checksum.toString(8).padStart(6, "0") + "\0 ";

  return header.padEnd(512, "\0");
}

function parseTarHeader(buffer: Buffer): { path: string; size: number } | null {
  const path = buffer.toString("utf8", 0, 100).split("\0")[0] ?? "";
  if (!path) return null;
  const sizeStr = buffer.toString("utf8", 124, 136).split("\0")[0] ?? "";
  const size = parseInt(sizeStr, 8);
  if (!Number.isFinite(size) || size < 0) return null;
  return { path, size };
}

function sizeToOctal(size: number, width: number): string {
  return size.toString(8).padStart(width - 1, "0") + "\0";
}

function timeToOctal(time: number, width: number): string {
  return time.toString(8).padStart(width - 1, "0") + "\0";
}

function computeTarChecksum(buffer: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] ?? 0;
  }
  return sum;
}

/**
 * Create a signed .krwn package from a module directory.
 */
export async function signKrwnPackage(input: SignKrwnPackageInput): Promise<SignKrwnPackageResult> {
  const absSourceDir = resolve(input.sourceDir);
  const absOutFile = resolve(input.outFile);

  const manifestPath = resolve(absSourceDir, KRWN_PACKAGE_MANIFEST_PATH);
  try {
    const json = JSON.parse(readFileSync(manifestPath, "utf8"));
    const v = validateKrwnModuleManifest(json);
    if (!v.ok) throw new Error(`Invalid manifest: ${v.errors.join("; ")}`);
  } catch (e) {
    throw new Error(
      `Failed to read/validate krwn.module.json: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let privKey;
  try {
    privKey = createPrivateKey(input.privateKeyPem);
  } catch (e) {
    throw new Error(`Invalid private key: ${e instanceof Error ? e.message : String(e)}`);
  }

  const entries = new Map<string, Uint8Array>();
  entries.set(KRWN_PACKAGE_MANIFEST_PATH, new Uint8Array(readFileSync(manifestPath)));

  const moduleDir = resolve(absSourceDir, "module");
  try {
    const stat = statSync(moduleDir);
    if (stat.isDirectory()) {
      const walk = (dir: string) => {
        const files = readdirSync(dir, { withFileTypes: true });
        files.sort((a, b) => a.name.localeCompare(b.name));
        for (const file of files) {
          const fullPath = resolve(dir, file.name);
          const relPath = relative(moduleDir, fullPath).replace(/\\/g, "/");
          if (file.isFile()) {
            entries.set(`${KRWN_PACKAGE_MODULE_PREFIX}${relPath}`, new Uint8Array(readFileSync(fullPath)));
          } else if (file.isDirectory()) {
            walk(fullPath);
          }
        }
      };
      walk(moduleDir);
    }
  } catch {
    // module/ dir may not exist
  }

  const contentHash = computeContentHash(entries);

  const pubKey = createPublicKey(privKey);
  const pubKeyPem = pubKey.export({ format: "pem", type: "spki" }).toString("utf8");
  const publicKeyFingerprint = fingerprintEd25519PublicKeyPem(pubKeyPem);
  const signedAt = new Date().toISOString();

  const ZERO = Buffer.from([0]);
  const msg = Buffer.concat([
    Buffer.from(`${KRWN_SIGNATURE_DOMAIN}/v${KRWN_PACKAGE_FORMAT_VERSION}`, "utf8"),
    ZERO,
    Buffer.from(input.publisherId, "utf8"),
    ZERO,
    Buffer.from(publicKeyFingerprint, "utf8"),
    ZERO,
    Buffer.from(signedAt, "utf8"),
    ZERO,
    contentHash,
  ]);

  const signatureBytes = sign(null, msg, privKey);
  const signatureFile: KrwnPackageSignatureFile = {
    version: KRWN_PACKAGE_FORMAT_VERSION,
    algorithm: KRWN_SIGNATURE_ALGORITHM,
    signedAt,
    publisherId: input.publisherId,
    publicKeyFingerprint,
    contentHash: contentHash.toString("hex"),
    signature: signatureBytes.toString("base64"),
  };

  entries.set(KRWN_PACKAGE_SIGNATURE_PATH, new Uint8Array(Buffer.from(JSON.stringify(signatureFile, null, 2) + "\n")));

  const tarBuffer = tarPack(entries);
  await pipeline(
    (async function* () {
      yield tarBuffer;
    })(),
    createGzip(),
    createWriteStream(absOutFile),
  );

  return {
    publicKeyFingerprint,
    contentHash: contentHash.toString("hex"),
    signature: signatureBytes.toString("base64"),
  };
}

/**
 * Verify a signed .krwn package and extract its manifest.
 */
export async function verifyKrwnPackage(
  filePath: string,
  options: { trustedKeys?: PublicKeyEntry[] } = {},
): Promise<VerifyKrwnPackageResult> {
  const absPath = resolve(filePath);

  try {
    statSync(absPath);
  } catch {
    return {
      ok: false,
      reason: "invalid_archive",
      details: "File not found or not accessible",
    };
  }

  let entries: Map<string, Uint8Array>;
  try {
    entries = await readKrwnPackageSync(absPath);
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_archive",
      details: e instanceof Error ? e.message : String(e),
    };
  }

  const manifestData = entries.get(KRWN_PACKAGE_MANIFEST_PATH);
  if (!manifestData) {
    return {
      ok: false,
      reason: "invalid_archive",
      details: "krwn.module.json not found in archive",
    };
  }

  let manifest: KrwnModuleManifest;
  try {
    const json = JSON.parse(Buffer.from(manifestData).toString("utf8"));
    const v = validateKrwnModuleManifest(json);
    if (!v.ok) {
      return {
        ok: false,
        reason: "manifest_invalid",
        details: v.errors.join("; "),
      };
    }
    manifest = v.manifest;
  } catch (e) {
    return {
      ok: false,
      reason: "manifest_invalid",
      details: e instanceof Error ? e.message : String(e),
    };
  }

  const sigData = entries.get(KRWN_PACKAGE_SIGNATURE_PATH);
  if (!sigData) {
    return {
      ok: false,
      reason: "invalid_archive",
      details: "SIGNATURE not found in archive",
    };
  }

  let signatureFile: KrwnPackageSignatureFile;
  try {
    signatureFile = JSON.parse(Buffer.from(sigData).toString("utf8"));
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_archive",
      details: "SIGNATURE is not valid JSON",
    };
  }

  const computedHash = computeContentHash(entries);
  if (computedHash.toString("hex") !== signatureFile.contentHash) {
    return {
      ok: false,
      reason: "tampered_payload",
      details: "Content hash mismatch",
    };
  }

  if (!options.trustedKeys || options.trustedKeys.length === 0) {
    return {
      ok: false,
      reason: "untrusted_signer",
      details: "No trusted keys provided",
    };
  }

  let trustedKey: PublicKeyEntry | undefined;
  for (const key of options.trustedKeys) {
    const fp = fingerprintEd25519PublicKeyPem(key.publicKeyPem);
    if (fp === signatureFile.publicKeyFingerprint) {
      trustedKey = key;
      break;
    }
  }

  if (!trustedKey) {
    return {
      ok: false,
      reason: "untrusted_signer",
      details: `No trusted key found for fingerprint ${signatureFile.publicKeyFingerprint}`,
    };
  }

  const ZERO = Buffer.from([0]);
  const msg = Buffer.concat([
    Buffer.from(`${KRWN_SIGNATURE_DOMAIN}/v${signatureFile.version}`, "utf8"),
    ZERO,
    Buffer.from(signatureFile.publisherId, "utf8"),
    ZERO,
    Buffer.from(signatureFile.publicKeyFingerprint, "utf8"),
    ZERO,
    Buffer.from(signatureFile.signedAt, "utf8"),
    ZERO,
    Buffer.from(signatureFile.contentHash, "hex"),
  ]);

  const signature = Buffer.from(signatureFile.signature, "base64");

  try {
    const pubKey = createPublicKey(trustedKey.publicKeyPem);
    const isValid = verify(null, msg, pubKey, signature);

    if (!isValid) {
      return {
        ok: false,
        reason: "signature_mismatch",
        details: "Signature verification failed",
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: "signature_mismatch",
      details: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    ok: true,
    manifest,
    contentHash: computedHash.toString("hex"),
    signer: {
      id: signatureFile.publisherId,
      publicKeyFingerprint: signatureFile.publicKeyFingerprint,
    },
  };
}
