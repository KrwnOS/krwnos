import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import type { PermissionKey } from "./module-contract.js";
import manifestSchema from "./schemas/krwn-module-manifest.schema.json" with { type: "json" };

/**
 * Declarative package manifest for installable KrwnOS modules (`krwn.module.json`).
 * Runtime code still implements {@link KrwnModule}; this file describes packaging metadata.
 */
export interface KrwnModuleManifest {
  /** Optional; editors use this for JSON Schema completion. */
  $schema?: string;
  slug: string;
  version: string;
  permissions: PermissionKey[];
  /** Relative path to migrations directory (from module root). */
  migrations: string;
  /** npm-style peer dependency ranges, e.g. `{ "@krwnos/sdk": "^0.1.0" }`. */
  peerDeps: Record<string, string>;
  /** Relative path to UI entry (client bundle / page). */
  ui: string;
  /** Target Postgres schema identifier for module tables. */
  schemaName: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const validate = ajv.compile(manifestSchema);

export type ValidateKrwnModuleManifestResult =
  | { ok: true; manifest: KrwnModuleManifest }
  | { ok: false; errors: string[] };

/**
 * Validate unknown JSON against the published `krwn-module-manifest.schema.json`.
 * Use from CLI (`krwn module validate`), install flows, or admin uploads.
 */
export function validateKrwnModuleManifest(data: unknown): ValidateKrwnModuleManifestResult {
  if (validate(data)) {
    return { ok: true, manifest: data as unknown as KrwnModuleManifest };
  }
  const errs = validate.errors ?? [];
  const errors = errs.map((e: ErrorObject) => {
    const path = e.instancePath || "(root)";
    const msg = e.message ?? "invalid";
    return `${path} ${msg}${e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : ""}`.trim();
  });
  return { ok: false, errors };
}

export { manifestSchema as krwnModuleManifestJsonSchema };
