/**
 * Module surface types — kept in structural sync with `src/types/kernel.ts`
 * in the KrwnOS app until the app re-exports from this package.
 */

export type PermissionKey = `${string}.${string}` | "*";

export interface PermissionDescriptor {
  key: PermissionKey;
  owner: string;
  label: string;
  description?: string;
  sovereignOnly?: boolean;
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

/**
 * Identifies the caller a module invocation is running on behalf of.
 *
 * `null` on `ModuleContext.auth` indicates a system-initiated call
 * (background job, lifecycle hook, kernel-emitted event). User-initiated
 * flows populate this with at least a `userId`; more fields
 * (e.g. `sessionId`, delegation claims) may be added later without
 * breaking the shape.
 */
export interface ModuleAuth {
  userId: string;
}

export interface ModuleSecretStore {
  /**
   * Securely retrieve a secret value for this module in the current State.
   * Returns null if the secret is not set.
   */
  get(key: string): Promise<string | null>;
}

export interface ModuleDatabaseTransaction {
  /**
   * Execute a raw SQL query within the module's sandboxed schema.
   */
  queryRaw<T = unknown>(sql: string, ...values: unknown[]): Promise<T[]>;
  
  /**
   * Execute a raw SQL command within the module's sandboxed schema.
   * Returns the number of affected rows.
   */
  executeRaw(sql: string, ...values: unknown[]): Promise<number>;
}

export interface ModuleDatabase {
  /**
   * Execute database operations within an interactive transaction that has
   * the PostgreSQL search_path correctly set to the module's isolated schema.
   */
  transaction<T>(fn: (tx: ModuleDatabaseTransaction) => Promise<T>): Promise<T>;
}

export interface ModuleContext {
  stateId: string;
  userId: string | null;
  /**
   * The caller for this invocation. `null` for system-initiated calls
   * (jobs, hooks). New module code should prefer `auth.userId` — the
   * top-level `userId` is kept for backwards compatibility.
   */
  auth: ModuleAuth | null;
  permissions: ReadonlySet<PermissionKey>;
  bus: ModuleEventBus;
  logger: ModuleLogger;
  secrets: ModuleSecretStore;
  db: ModuleDatabase;
}

export interface ModuleWidget {
  id: string;
  title: string;
  component: unknown;
  requiredPermission?: PermissionKey;
  defaultSize?: "sm" | "md" | "lg" | "xl";
}

export interface ModuleSettingsPanel {
  title: string;
  component: unknown;
  requiredPermission?: PermissionKey;
}

export interface KrwnModule {
  readonly slug: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;

  init():
    | { permissions: PermissionDescriptor[] }
    | Promise<{ permissions: PermissionDescriptor[] }>;

  getWidget(ctx: ModuleContext): ModuleWidget | ModuleWidget[] | null;
  getSettings(ctx: ModuleContext): ModuleSettingsPanel | null;
}
