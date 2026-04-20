/**
 * KrwnOS Kernel Types
 * ------------------------------------------------------------
 * Canonical contracts shared between the core and every module.
 * The core MUST NOT import anything from `/src/modules`.
 * Modules MUST only depend on this file (plus public core APIs).
 *
 * Module contract types (`KrwnModule`, `ModuleContext`, permissions)
 * are defined in `@krwnos/sdk` and re-exported here for stable `@/types/kernel` imports.
 */

import type { PermissionKey } from "@krwnos/sdk";

export type {
  KrwnModule,
  ModuleContext,
  ModuleEventBus,
  ModuleLogger,
  ModuleSettingsPanel,
  ModuleWidget,
  PermissionDescriptor,
  PermissionKey,
} from "@krwnos/sdk";

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
// See `@krwnos/sdk` — re-exported at the top of this file.

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
  | "magic_email"
  | "telegram";

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
