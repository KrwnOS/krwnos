import type {
  KrwnModule,
  ModuleContext,
  ModuleEventBus,
  ModuleLogger,
  PermissionKey,
} from "./module-contract.js";

export function createNoopModuleLogger(): ModuleLogger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

export function createMemoryEventBus(): ModuleEventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();

  return {
    async emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      await Promise.all([...set].map((h) => Promise.resolve(h(payload))));
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      const wrapped = handler as (payload: unknown) => void | Promise<void>;
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
        if (set && set.size === 0) handlers.delete(event);
      };
    },
  };
}

export interface TestModuleContextOptions {
  stateId?: string;
  userId?: string | null;
  permissions?: Iterable<PermissionKey>;
  bus?: ModuleEventBus;
  logger?: ModuleLogger;
}

export function createTestModuleContext(options: TestModuleContextOptions = {}): ModuleContext {
  const stateId = options.stateId ?? "state_test";
  const userId = options.userId !== undefined ? options.userId : "user_test";
  const perms = options.permissions ?? (["*"] as PermissionKey[]);
  return {
    stateId,
    userId,
    permissions: new Set(perms),
    bus: options.bus ?? createMemoryEventBus(),
    logger: options.logger ?? createNoopModuleLogger(),
  };
}

export interface RunModuleHarnessOptions extends TestModuleContextOptions {}

export interface RunModuleHarnessResult {
  initResult: Awaited<ReturnType<KrwnModule["init"]>>;
  widget: ReturnType<KrwnModule["getWidget"]>;
  settings: ReturnType<KrwnModule["getSettings"]>;
  ctx: ModuleContext;
}

/**
 * Runs `init()`, then `getWidget` / `getSettings` with a throwaway test context.
 * For unit tests of third-party or in-repo modules without booting Next.js.
 */
export async function runModuleHarness(
  mod: KrwnModule,
  options: RunModuleHarnessOptions = {},
): Promise<RunModuleHarnessResult> {
  const initResult = await mod.init();
  const ctx = createTestModuleContext(options);
  const widget = mod.getWidget(ctx);
  const settings = mod.getSettings(ctx);
  return { initResult, widget, settings, ctx };
}
