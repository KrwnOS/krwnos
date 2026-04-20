/**
 * Public core surface. Modules import ONLY from here.
 * Never re-export Prisma / Redis / framework internals.
 */

export { PermissionsEngine, permissionsEngine } from "./permissions-engine";
export type {
  PermissionCheckInput,
  PermissionCheckResult,
} from "./permissions-engine";

export {
  ModuleRegistry,
  registry,
  exchangeService,
  registerCorePermissions,
} from "./registry";

// --- Krwn Exchange Engine (межгосударственная торговля) ---
export {
  ExchangeService,
  ExchangeError,
  ExchangePermissions,
  EXCHANGE_MODULE_SLUG,
  EXCHANGE_EVENTS,
  exchangePermissionDescriptors,
  roundToDecimals as exchangeRoundToDecimals,
  type CrossStateTransaction,
  type CrossStateTransferInput,
  type ExchangeActor,
  type ExchangeAssetRef,
  type ExchangeErrorCode,
  type ExchangePair,
  type ExchangeRepository,
  type ExchangeServiceDeps,
  type ExchangeStateAccess,
  type ExchangeWalletRef,
  type Quote as ExchangeQuote,
  type UpsertPairInput,
} from "./exchange";
export { createPrismaExchangeRepository } from "./exchange-prisma";

export {
  InMemoryEventBus,
  RedisEventBus,
  eventBus,
  setEventBus,
  getEventBus,
  KernelEvents,
  type KernelEvent,
  type RedisEventBusOptions,
  type RedisLike,
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
  createS3BackupStorage,
  createS3ClientFromBackupEnv,
  deleteS3BackupObject,
  parseS3Uri,
  readS3BackupEnv,
  type ReadS3BackupEnvResult,
} from "./backup-s3-storage";

export {
  CredentialsRegistry,
  credentialsRegistry,
  type CredentialProvider,
  type CredentialRepository,
} from "./auth-credentials";

export {
  readSmtpEnv,
  createSmtpTransport,
  createSmtpTransportFromEnv,
  sendMagicEmail,
  type SmtpEnvConfig,
  type MagicEmailMessage,
  type SendMagicEmailContext,
} from "./magic-email-smtp";

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

// --- Палата Указов (Sovereign's Decree) ---
export {
  StateConfigService,
  StateConfigError,
  StateConfigPermissions,
  STATE_CONFIG_EVENTS,
  STATE_CONFIG_MODULE_SLUG,
  DEFAULT_STATE_SETTINGS,
  stateConfigPermissionDescriptors,
  summariseSettings,
  validatePatch as validateStateSettingsPatch,
  type StateConfigAccessContext,
  type StateConfigErrorCode,
  type StateConfigRepository,
  type StateConfigServiceDeps,
  type StateSettings,
  type StateSettingsSummary,
  type StateSettingsUpdatedEvent,
  type TreasuryTransparency,
  type UpdateStateSettingsPatch,
} from "./state-config";
export { createPrismaStateConfigRepository } from "./state-config-prisma";

// --- Citizen administration (Vertical + kernel) ---
export {
  MembershipAdminPermissions,
  membershipAdminPermissionDescriptors,
} from "./membership-admin-permissions";
export {
  canAccessCitizensAdminScreen,
  canActOnVerticalNode,
  canAdmitToNode,
  canKickOnNode,
  canMoveFromNode,
  canMoveToNode,
  canEditTitleOnNode,
  canBanOrMerge,
} from "./citizens-admin-logic";

// --- State Pulse (Пульс Государства / Activity Feed) ---
export { ACTIVITY_EVENTS } from "./activity-events";
export {
  ActivityFeedService,
  ACTIVITY_SUBSCRIBED_EVENTS,
  subscribeActivityFeed,
  isActivityEntryVisibleToViewer,
  type ActivityCategory,
  type ActivityLog,
  type ActivityRecordedEvent,
  type ActivityRepository,
  type ActivityFeedServiceDeps,
  type ActivityViewerContext,
  type ActivityVisibility,
  type ListActivityOptions,
  type RecordActivityInput,
} from "./activity-feed";
export { createPrismaActivityRepository } from "./activity-feed-prisma";

// --- Theme Engine (Движок Тем) ---
export {
  DEFAULT_THEME_CONFIG,
  MINIMAL_HIGHTECH_THEME,
  TERMINAL_THEME,
  GLASS_THEME,
  ROYAL_GOLD_THEME,
  CYBERPUNK_THEME,
  THEME_PRESETS,
  THEME_PRESET_ORDER,
  ThemeValidationError,
  cloneTheme,
  getPreset,
  hexToHslTriple,
  isPresetId,
  normaliseThemeConfig,
  renderThemeCss,
  sanitiseCustomCss,
  validateThemeConfig,
  type ThemeColors,
  type ThemeConfig,
  type ThemeEffects,
  type ThemeFonts,
  type ThemePresetId,
  type ThemeRadius,
} from "./theme";

// --- Governance rules (shared types for Core Governance module) ---
export {
  DEFAULT_GOVERNANCE_RULES,
  GOVERNANCE_MANAGEABLE_KEYS,
  GovernanceRulesError,
  isGovernanceManageableKey,
  normaliseGovernanceRules,
  resolveAllowedKeys,
  validateGovernanceRulesPatch,
  type GovernanceManageableKey,
  type GovernanceMode,
  type GovernanceRules,
  type WeightStrategy,
} from "./governance-rules";

// --- Auto-promotion (vertical cron; pure rules + job in `src/jobs`) ---
export {
  fullDaysBetween,
  shouldPromoteMembershipForAutoPromotion,
} from "./auto-promotion";
