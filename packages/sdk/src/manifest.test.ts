import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateKrwnModuleManifest } from "./manifest.js";

const fixturePath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "modules",
  "example-good",
  "krwn.module.json",
);

describe("validateKrwnModuleManifest", () => {
  it("accepts the repo fixture", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
    const r = validateKrwnModuleManifest(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.slug).toBe("example.good");
      expect(r.manifest.peerDeps["@krwnos/sdk"]).toBe("^0.1.0");
    }
  });

  it("rejects invalid slug", () => {
    const r = validateKrwnModuleManifest({
      slug: "Bad_Slug",
      version: "1.0.0",
      permissions: ["a.b"],
      migrations: "m",
      peerDeps: {},
      ui: "u",
      schemaName: "krwn_x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("slug"))).toBe(true);
  });

  it("rejects bad semver version", () => {
    const r = validateKrwnModuleManifest({
      slug: "ok.slug",
      version: "not-semver",
      permissions: ["*"],
      migrations: "m",
      peerDeps: {},
      ui: "u",
      schemaName: "krwn_x",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects permission without a dot (except star)", () => {
    const r = validateKrwnModuleManifest({
      slug: "ok.slug",
      version: "1.0.0",
      permissions: ["nope"],
      migrations: "m",
      peerDeps: {},
      ui: "u",
      schemaName: "krwn_x",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects extra top-level keys", () => {
    const r = validateKrwnModuleManifest({
      slug: "ok.slug",
      version: "1.0.0",
      permissions: ["a.b"],
      migrations: "m",
      peerDeps: {},
      ui: "u",
      schemaName: "krwn_x",
      surprise: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /additional properties|must NOT have additional/i.test(e))).toBe(true);
  });

  it("rejects non-object root", () => {
    const r = validateKrwnModuleManifest("nope");
    expect(r.ok).toBe(false);
  });
});
