/**
 * KrwnOS Kernel Types
 * ------------------------------------------------------------
 * Canonical contracts shared between the core and every module.
 * The core MUST NOT import anything from `/src/modules`.
 * Modules MUST only depend on this file (plus public core APIs).
 */

// ============================================================
// 1. Permissions
// ============================================================

/**
 * A permission is an opaque string key in the form
 *   `<domain>.<action>`   e.g. "finance.read", "members.kick"
 *
 * Rules:
 *   * Lowercase, dot-separated.
 *   * Domain is owned by a module slug OR by the core ("core").
 *   * Use the wildcard "*" only at the top level of a role
 *     (effectively grants the Sovereign all rights).
 */
export type PermissionKey = `${string}.${string}` | "*";

/**
 * Runtime descriptor registered by a module at `init()` time.
 * The Registry collects these and exposes them to the Vertical
 * editor so that the Sovereign can attach them to nodes.
 */
export interface PermissionDescriptor {
  key: PermissionKey;
  /** Module slug that owns this permission ("core" for kernel). */
  owner: string;
  label: string;
  description?: string;
  /** If true, this permission can never be granted to non-owners. */
  sovereignOnly?: boolean;
}

// ============================================================
// 2. Identity
// ============================================================

export interface UserRef {
  id: string;
  handle: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

// ============================================================
// 3. State (Государство)
// ============================================================

export interface StateTheme {
  primaryColor?: string;
  accentColor?: string;
  crest?: string; // URL to crest / logo
  motto?: string;
}

export interface StateConfig {
  theme: StateTheme;
  /** Module slugs that are installed & enabled in this State. */
  installedModules: string[];
  /** Arbitrary flags, feature toggles. */
  flags?: Record<string, boolean>;
}

export interface State {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  ownerId: string;
  config: StateConfig;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// 4. Vertical (Дерево власти)
// ============================================================

export type VerticalNodeType = "position" | "department" | "rank";

/**
 * A single node of the Vertical — the building block of power.
 * A node has exactly one parent (except the root) and many
 * children, forming a directed tree per State.
 */
export interface VerticalNode {
  id: string;
  stateId: string;
  parentId: string | null;
  title: string;
  type: VerticalNodeType;
  permissions: PermissionKey[];
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Hydrated tree variant returned by query helpers. */
export interface VerticalNodeTree extends VerticalNode {
  children: VerticalNodeTree[];
  members: UserRef[];
}

export interface Membership {
  id: string;
  userId: string;
  nodeId: string;
  title?: string | null;
  createdAt: Date;
}

// ============================================================
// 5. Module contract (плагин)
// ============================================================

/**
 * Minimal runtime context passed to every module method.
 * The core decides what to expose here — modules never touch
 * Prisma or Redis directly.
 */
export interface ModuleContext {
  stateId: string;
  userId: string | null;
  /** Canonical permissions the current user holds in this State. */
  permissions: ReadonlySet<PermissionKey>;
  /** Typed event bus (see `core/event-bus`). */
  bus: ModuleEventBus;
  /** Lightweight logger; implementations may forward to OTEL. */
  logger: ModuleLogger;
}

export interface ModuleLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ModuleEventBus {
  emit<T = unknown>(event: string, payload: T): Promise<void>;
  on<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): () => void;
}

/** Descriptor returned by `module.getWidget()`. */
export interface ModuleWidget {
  /** Stable id, unique within the module. */
  id: string;
  title: string;
  /** React component reference; rendered by the Dynamic UI shell. */
  component: unknown;
  /** Permission required to display this widget. */
  requiredPermission?: PermissionKey;
  defaultSize?: "sm" | "md" | "lg" | "xl";
}

/** Descriptor returned by `module.getSettings()`. */
export interface ModuleSettingsPanel {
  title: string;
  component: unknown;
  /** Only the State owner or holders of this permission may edit. */
  requiredPermission?: PermissionKey;
}

/**
 * Every module MUST implement this interface.
 * The core communicates with it exclusively through these methods.
 */
export interface KrwnModule {
  /** Globally unique, dot-namespaced slug: "core.chat", "treasury". */
  readonly slug: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;

  /**
   * Called once when the module is registered into the Registry.
   * The module MUST declare every permission it will ever check.
   */
  init(): {
    permissions: PermissionDescriptor[];
  } | Promise<{ permissions: PermissionDescriptor[] }>;

  /** Desktop widget(s) contributed to the Dynamic UI. */
  getWidget(ctx: ModuleContext): ModuleWidget | ModuleWidget[] | null;

  /** Settings panel for the State owner. */
  getSettings(ctx: ModuleContext): ModuleSettingsPanel | null;
}

// ============================================================
// 6. Invitations (Magic links / QR passports)
// ============================================================

export type InvitationStatus = "active" | "consumed" | "revoked" | "expired";

export interface Invitation {
  id: string;
  stateId: string;
  targetNodeId: string | null;
  createdById: string;
  code: string;
  label?: string | null;
  maxUses: number;
  usesCount: number;
  expiresAt: Date | null;
  status: InvitationStatus;
  createdAt: Date;
  consumedAt: Date | null;
}

/** Payload returned ONCE when an invitation is created. */
export interface IssuedInvitation {
  invitation: Invitation;
  /** Raw token — only shown at creation; never stored in plaintext. */
  token: string;
  /** Shareable URL: `${origin}/invite/${token}`. */
  url: string;
  /** Data URI of the QR code encoding the URL. */
  qr?: string;
}

// ============================================================
// 7. Auth credentials (passwordless)
// ============================================================

export type AuthCredentialKind =
  | "passkey"
  | "wallet_ethereum"
  | "wallet_solana"
  | "oauth_github"
  | "oauth_google"
  | "magic_email";

export interface AuthCredential {
  id: string;
  userId: string;
  kind: AuthCredentialKind;
  identifier: string;
  label?: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

// ============================================================
// 8. Deployment tiers
// ============================================================

export type DeploymentTier =
  /** Desktop / Electron sandbox for local use. */
  | "sandbox"
  /** Self-hosted VPS / home server (docker-compose). */
  | "pro"
  /** One-click cloud image (DigitalOcean, Linode, AWS Marketplace). */
  | "cloud";

export interface DeploymentInfo {
  tier: DeploymentTier;
  hostname: string;
  tunnel?: {
    provider: "cloudflared" | "frp" | "ngrok" | "tailscale_funnel" | "none";
    enabled: boolean;
    publicUrl?: string;
  };
  version: string;
}

// ============================================================
// 9. Power Engine inputs
// ============================================================

/**
 * Pre-computed view of the Vertical passed to the Permissions
 * Engine. Kept flat for O(1) parent lookups.
 */
export interface VerticalSnapshot {
  stateId: string;
  nodes: Map<string, VerticalNode>;
  /** userId -> set of node ids the user belongs to. */
  membershipsByUser: Map<string, Set<string>>;
}
