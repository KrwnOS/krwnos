import type {
  ModuleContext,
  ModuleDatabase,
  ModuleDatabaseTransaction,
  ModuleSecretStore,
  PermissionKey,
} from "@krwnos/sdk";
import { modulePostgresSchemaName } from "@krwnos/sdk";
import { prisma } from "@/lib/prisma";
import { decryptModuleSecret } from "./module-secret-vault";

interface SandboxedContextOptions {
  stateId: string;
  userId: string | null;
  moduleSlug: string;
  permissions: ReadonlySet<PermissionKey>;
  bus: ModuleContext["bus"];
  logger: ModuleContext["logger"];
}

/**
 * Creates a ModuleSecretStore that reads from the `InstalledModule.config.secrets`
 * and decrypts them using the core vault.
 */
function createSecretStore(stateId: string, moduleSlug: string): ModuleSecretStore {
  return {
    async get(key: string): Promise<string | null> {
      const installed = await prisma.installedModule.findUnique({
        where: { stateId_slug: { stateId, slug: moduleSlug } },
        select: { config: true },
      });

      if (!installed) return null;

      const config = installed.config as { secrets?: Record<string, string> } | null;
      const encrypted = config?.secrets?.[key];

      if (!encrypted) return null;

      const authSecret = process.env.AUTH_SECRET;
      if (!authSecret) {
        throw new Error("[ModuleSandbox] AUTH_SECRET is not configured");
      }

      try {
        return decryptModuleSecret(stateId, encrypted, authSecret);
      } catch (err) {
        // We do not throw or log the plain secret/error details to avoid leaks
        return null;
      }
    },
  };
}

/**
 * Creates a ModuleDatabase wrapper that executes raw queries in the
 * module's dedicated schema via an interactive transaction.
 */
function createDatabaseSandbox(stateId: string, moduleSlug: string): ModuleDatabase {
  // Use a stable prefix for the stateId (e.g., first 8 hex chars if it's a cuid or uuid)
  // To keep it simple and robust, we use the raw stateId if it's short, or a deterministic substring.
  // Assuming stateId is a cuid like 'c...'.
  const stateIdPrefix = stateId.slice(0, 8);
  const schemaName = modulePostgresSchemaName(moduleSlug, stateIdPrefix);

  return {
    async transaction<T>(fn: (tx: ModuleDatabaseTransaction) => Promise<T>): Promise<T> {
      return await prisma.$transaction(async (tx) => {
        // 1. Set the search path for this transaction specifically
        // Note: We use executeRawUnsafe because the schema name is dynamic, 
        // but it is validated by modulePostgresSchemaName to be a safe identifier.
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}"`);

        // 2. Provide the sandboxed transaction interface
        const sandboxedTx: ModuleDatabaseTransaction = {
          async queryRaw<R = unknown>(sql: string, ...values: unknown[]): Promise<R[]> {
            // We must use queryRawUnsafe here because we are passing a dynamic SQL string
            // from the module. The module is responsible for parameterizing it or using 
            // a query builder.
            return await tx.$queryRawUnsafe<R[]>(sql, ...values);
          },
          async executeRaw(sql: string, ...values: unknown[]): Promise<number> {
            return await tx.$executeRawUnsafe<number>(sql, ...values);
          },
        };

        // 3. Execute the module's callback
        return await fn(sandboxedTx);
      });
    },
  };
}

/**
 * Bootstraps a fully isolated ModuleContext for a given module and state.
 */
export function createSandboxedContext(options: SandboxedContextOptions): ModuleContext {
  return {
    stateId: options.stateId,
    userId: options.userId,
    auth: options.userId ? { userId: options.userId } : null,
    permissions: options.permissions,
    bus: options.bus,
    logger: options.logger,
    secrets: createSecretStore(options.stateId, options.moduleSlug),
    db: createDatabaseSandbox(options.stateId, options.moduleSlug),
  };
}
