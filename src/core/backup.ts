/**
 * Backup Engine — полный слепок State.
 * ------------------------------------------------------------
 * Спецификация слепка (версия 1):
 *
 *   {
 *     manifest: {
 *       krwnos: "1",
 *       createdAt: ISO,
 *       stateId, stateSlug, schemaRev, checksumAlgo
 *     },
 *     state:        State record (sanitized),
 *     vertical:     VerticalNode[],
 *     memberships:  Membership[] (пользователи по handle),
 *     modules:      InstalledModule[] (+ их private-данные если
 *                   модуль реализовал exportData() — hook из Registry),
 *     invitations:  Invitation[] (без tokenHash),
 *   }
 *
 * Реализация в этом файле — ИНТЕРФЕЙСНАЯ. Конкретные адаптеры
 * хранилища (file://, s3://, r2://) регистрируются отдельно.
 */

import { createHash } from "node:crypto";
import type { State, VerticalNode } from "@/types/kernel";

export const BACKUP_SCHEMA_REV = 1;

export interface BackupMembershipRow {
  userHandle: string;
  nodeId: string;
  title: string | null;
}

export interface BackupModuleRow {
  slug: string;
  version: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Optional module-private data returned from `module.exportData()`. */
  data?: unknown;
}

export interface BackupPayload {
  manifest: {
    krwnos: "1";
    createdAt: string;
    stateId: string;
    stateSlug: string;
    schemaRev: number;
    checksumAlgo: "sha256";
  };
  state: Omit<State, "ownerId"> & {
    ownerHandle: string;
    /** Mirrors `State.themeConfig` (Theme Engine). Omitted in older snapshots. */
    themeConfig?: Record<string, unknown>;
  };
  vertical: VerticalNode[];
  memberships: BackupMembershipRow[];
  modules: BackupModuleRow[];
  invitations: Array<{
    code: string;
    label: string | null;
    targetNodeId: string | null;
    maxUses: number;
    expiresAt: string | null;
  }>;
}

export interface BackupStorage {
  /** Write archive bytes, returning an opaque URI + final byte size. */
  write(
    filename: string,
    bytes: Uint8Array,
  ): Promise<{ uri: string; sizeBytes: number }>;

  /** Read archive bytes by URI. */
  read(uri: string): Promise<Uint8Array>;
}

export interface BackupSource {
  collectState(stateId: string): Promise<BackupPayload["state"]>;
  collectVertical(stateId: string): Promise<VerticalNode[]>;
  collectMemberships(stateId: string): Promise<BackupMembershipRow[]>;
  collectModules(stateId: string): Promise<BackupModuleRow[]>;
  collectInvitations(stateId: string): Promise<BackupPayload["invitations"]>;
}

export interface BackupSink {
  recordManifest(params: {
    stateId: string;
    storageUri: string;
    schemaRev: number;
    sizeBytes: number;
    checksum: string;
  }): Promise<void>;

  restore(payload: BackupPayload): Promise<void>;
}

export class BackupService {
  constructor(
    private readonly source: BackupSource,
    private readonly sink: BackupSink,
    private readonly storage: BackupStorage,
  ) {}

  /** Build a full snapshot, persist it, and record the manifest. */
  async create(stateId: string): Promise<{
    uri: string;
    sizeBytes: number;
    checksum: string;
    payload: BackupPayload;
  }> {
    const [state, vertical, memberships, modules, invitations] =
      await Promise.all([
        this.source.collectState(stateId),
        this.source.collectVertical(stateId),
        this.source.collectMemberships(stateId),
        this.source.collectModules(stateId),
        this.source.collectInvitations(stateId),
      ]);

    const payload: BackupPayload = {
      manifest: {
        krwnos: "1",
        createdAt: new Date().toISOString(),
        stateId,
        stateSlug: state.slug,
        schemaRev: BACKUP_SCHEMA_REV,
        checksumAlgo: "sha256",
      },
      state,
      vertical,
      memberships,
      modules,
      invitations,
    };

    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const checksum = createHash("sha256").update(bytes).digest("hex");

    const filename = `krwn-${state.slug}-${Date.now()}.json`;
    const { uri, sizeBytes } = await this.storage.write(filename, bytes);

    await this.sink.recordManifest({
      stateId,
      storageUri: uri,
      schemaRev: BACKUP_SCHEMA_REV,
      sizeBytes,
      checksum,
    });

    return { uri, sizeBytes, checksum, payload };
  }

  /**
   * Load and re-hydrate a backup. The sink implementation decides
   * whether this is a "restore in place" or "fork into new State".
   */
  async restore(uri: string): Promise<BackupPayload> {
    const raw = await this.storage.read(uri);
    const payload = JSON.parse(new TextDecoder().decode(raw)) as BackupPayload;

    if (payload.manifest.krwnos !== "1") {
      throw new Error(
        `Unsupported backup format: ${payload.manifest.krwnos}`,
      );
    }
    if (payload.manifest.schemaRev > BACKUP_SCHEMA_REV) {
      throw new Error(
        `Backup schemaRev=${payload.manifest.schemaRev} is newer than this KrwnOS build (${BACKUP_SCHEMA_REV}). Upgrade first.`,
      );
    }

    await this.sink.restore(payload);
    return payload;
  }
}
