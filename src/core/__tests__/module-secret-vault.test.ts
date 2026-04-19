/**
 * AEAD для модульных секретов: смена `AUTH_SECRET` или подмена ключа
 * не даёт расшифровать ранее записанный пакет.
 */

import { describe, expect, it } from "vitest";
import {
  decryptModuleSecret,
  encryptModuleSecret,
} from "../module-secret-vault";

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);
const STATE_ID = "state_cln9a7x2_test";

describe("module-secret-vault (AEAD)", () => {
  it("round-trips plaintext with the same AUTH_SECRET and stateId", () => {
    const plain = "api_key_for_module_xyz";
    const packed = encryptModuleSecret(STATE_ID, plain, SECRET_A);
    expect(decryptModuleSecret(STATE_ID, packed, SECRET_A)).toBe(plain);
  });

  it("fails to decrypt when AUTH_SECRET was rotated (wrong key)", () => {
    const packed = encryptModuleSecret(STATE_ID, "sensitive-value", SECRET_A);
    expect(() =>
      decryptModuleSecret(STATE_ID, packed, SECRET_B),
    ).toThrowError();
  });

  it("rejects AUTH_SECRET shorter than 32 characters", () => {
    expect(() =>
      encryptModuleSecret(STATE_ID, "x", "short"),
    ).toThrowError(/AUTH_SECRET must be at least/);
  });
});
