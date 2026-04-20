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

export interface ModuleContext {
  stateId: string;
  userId: string | null;
  permissions: ReadonlySet<PermissionKey>;
  bus: ModuleEventBus;
  logger: ModuleLogger;
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
