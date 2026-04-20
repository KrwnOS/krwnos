/**
 * Helpers for Postgres schema-per-module layouts (Horizon 3).
 * Convention: `krwn_<moduleSlug>_<stateIdPrefix>` with slug segments as underscores.
 */

/** Postgres max identifier length (bytes); we enforce on the full schema name. */
export const POSTGRES_MAX_IDENTIFIER_LENGTH = 63;

const IDENT_PART = /^[a-z][a-z0-9_]*$/;

function assertIdentifierPart(name: string, label: string): void {
  if (name.length === 0 || name.length > POSTGRES_MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `[krwnos/sdk] Invalid ${label}: must be 1–${POSTGRES_MAX_IDENTIFIER_LENGTH} chars after normalization.`,
    );
  }
  if (!IDENT_PART.test(name)) {
    throw new Error(
      `[krwnos/sdk] Invalid ${label}: must match /^[a-z][a-z0-9_]*$/ (got "${name}").`,
    );
  }
}

/**
 * Lowercase, non-alphanumerics → `_`, collapse repeats, trim edges.
 * Use for module slug segments and short state id prefixes.
 */
export function normalizeSchemaToken(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s.length === 0) {
    throw new Error(`[krwnos/sdk] normalizeSchemaToken: empty after normalization (input was "${raw}").`);
  }
  if (/^[0-9]/.test(s)) {
    throw new Error(`[krwnos/sdk] normalizeSchemaToken: must not start with a digit (got "${s}").`);
  }
  return s;
}

/**
 * Canonical schema name for a module’s isolated tables in a given State.
 *
 * @param moduleSlug — e.g. `core.chat`, `treasury`
 * @param stateIdPrefix — short stable prefix for the State (e.g. first 8 hex chars of `stateId` without hyphens)
 */
export function modulePostgresSchemaName(moduleSlug: string, stateIdPrefix: string): string {
  const slugPart = normalizeSchemaToken(moduleSlug.replace(/\./g, "_"));
  const statePart = normalizeSchemaToken(stateIdPrefix);
  assertIdentifierPart(slugPart, "module slug part");
  assertIdentifierPart(statePart, "state id prefix");
  const name = `krwn_${slugPart}_${statePart}`;
  if (name.length > POSTGRES_MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `[krwnos/sdk] Schema name exceeds ${POSTGRES_MAX_IDENTIFIER_LENGTH} chars: "${name}" (${name.length}). Shorten stateIdPrefix or module slug.`,
    );
  }
  return name;
}

/**
 * Double-quote a Postgres identifier for use in `SET search_path` / DDL.
 */
export function quotePostgresIdentifier(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Build `search_path` list string: `"schema_a", "schema_b", public`
 */
export function formatPostgresSearchPath(schemas: readonly string[]): string {
  if (schemas.length === 0) {
    throw new Error("[krwnos/sdk] formatPostgresSearchPath: at least one schema is required.");
  }
  return schemas.map(quotePostgresIdentifier).join(", ");
}
