export type {
  KrwnModule,
  ModuleContext,
  ModuleDatabase,
  ModuleDatabaseTransaction,
  ModuleEventBus,
  ModuleLogger,
  ModuleSecretStore,
  ModuleSettingsPanel,
  ModuleWidget,
  PermissionDescriptor,
  PermissionKey,
} from "./module-contract.js";

export type { KrwnModuleManifest, ValidateKrwnModuleManifestResult } from "./manifest.js";
export { krwnModuleManifestJsonSchema, validateKrwnModuleManifest } from "./manifest.js";

export {
  createMemoryEventBus,
  createNoopModuleLogger,
  createTestModuleContext,
  runModuleHarness,
  type RunModuleHarnessOptions,
  type RunModuleHarnessResult,
  type TestModuleContextOptions,
} from "./harness.js";

export {
  POSTGRES_MAX_IDENTIFIER_LENGTH,
  formatPostgresSearchPath,
  modulePostgresSchemaName,
  normalizeSchemaToken,
  quotePostgresIdentifier,
} from "./prisma-per-schema.js";
