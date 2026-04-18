/**
 * Public core surface. Modules import ONLY from here.
 * Never re-export Prisma / Redis / framework internals.
 */

export { PermissionsEngine, permissionsEngine } from "./permissions-engine";
export type {
  PermissionCheckInput,
  PermissionCheckResult,
} from "./permissions-engine";

export { ModuleRegistry, registry } from "./registry";

export {
  InMemoryEventBus,
  eventBus,
  KernelEvents,
  type KernelEvent,
} from "./event-bus";

export {
  type AuthAdapter,
  UnauthorizedError,
  setAuthAdapter,
  getAuth,
} from "./auth";

export {
  InvitationsService,
  InvitationPermissions,
  InvitationTokenError,
  type InvitationsRepository,
  type CreateInvitationInput,
  type ConsumeInvitationInput,
  type ConsumeResult,
} from "./invitations";

export {
  BackupService,
  BACKUP_SCHEMA_REV,
  type BackupPayload,
  type BackupStorage,
  type BackupSource,
  type BackupSink,
} from "./backup";

export {
  CredentialsRegistry,
  credentialsRegistry,
  type CredentialProvider,
  type CredentialRepository,
} from "./auth-credentials";

export {
  TunnelManager,
  TunnelEvents,
  type TunnelAdapter,
  type TunnelConfig,
  type TunnelProvider,
  type TunnelStatus,
} from "./tunneling";

export {
  CliTokenService,
  type CliTokenRepository,
  type CliTokenRow,
  type MintCliTokenInput,
  type RotateCliTokenInput,
  type MintResult as MintCliTokenResult,
  type RotateResult as RotateCliTokenResult,
} from "./cli-tokens";

export {
  setupState,
  AlreadyInitialisedError,
  type SetupStateInput,
  type SetupStateResult,
} from "./setup-state";
