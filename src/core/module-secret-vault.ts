/**
 * AEAD для секретов установленных модулей (`InstalledModule.config` и т.п.).
 * Ключ: HKDF-SHA256 от `AUTH_SECRET` с солью `stateId` и фиксированным info.
 * Алгоритм: AES-256-GCM (случайный 12-байтный nonce на шифрование).
 *
 * Не логирует и не включает в ошибки значения секретов или открытого текста.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HKDF_INFO = "krwnos:module-secret:v1";
const MIN_AUTH_SECRET_LEN = 32;

function deriveKey(authSecret: string, stateId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", authSecret, stateId, HKDF_INFO, KEY_LEN),
  );
}

function assertAuthSecret(authSecret: string): void {
  if (authSecret.length < MIN_AUTH_SECRET_LEN) {
    throw new Error(
      `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LEN} characters`,
    );
  }
}

/**
 * @returns Base64url-пакет: `iv (12) || tag (16) || ciphertext`.
 */
export function encryptModuleSecret(
  stateId: string,
  plaintext: string,
  authSecret: string,
): string {
  assertAuthSecret(authSecret);
  if (!stateId) {
    throw new Error("stateId is required");
  }

  const key = deriveKey(authSecret, stateId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptModuleSecret(
  stateId: string,
  packed: string,
  authSecret: string,
): string {
  assertAuthSecret(authSecret);
  if (!stateId) {
    throw new Error("stateId is required");
  }

  const buf = Buffer.from(packed, "base64url");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("invalid ciphertext");
  }

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(authSecret, stateId);
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
