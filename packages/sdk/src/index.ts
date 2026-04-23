export type {
  KrwnModule,
  ModuleAuth,
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

export { KrwnError } from "./errors.js";

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

export {
  KRWN_PACKAGE_MANIFEST_PATH,
  KRWN_PACKAGE_SIGNATURE_PATH,
  KRWN_PACKAGE_MODULE_PREFIX,
  KRWN_PACKAGE_FORMAT_VERSION,
  KRWN_SIGNATURE_ALGORITHM,
  KRWN_SIGNATURE_DOMAIN,
  KRWN_CONTENT_HASH_ALGORITHM,
  signKrwnPackage,
  verifyKrwnPackage,
  fingerprintEd25519PublicKeyPem,
  computeContentHash,
  tarPack,
  tarUnpack,
  readKrwnPackageSync,
  listFilesSync,
} from "./sign.js";
export type {
  PublicKeyEntry,
  KrwnPackageSignatureFile,
  KrwnPackageVerifyReason,
  VerifyKrwnPackageResult,
  VerifiedSigner,
  SignKrwnPackageInput,
} from "./sign.js";
