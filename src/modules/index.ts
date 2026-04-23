/**
 * Module bootstrap.
 * ------------------------------------------------------------
 * The ONLY place where concrete plugins are wired into the
 * core Registry. Keep this list minimal and let each module
 * register its own permissions in its `init()` method.
 */

import { registry } from "@/core";
import { coreChatModule } from "./chat";
import { coreGovernanceModule } from "./governance";
import { coreWalletModule } from "./wallet";
import { coreTasksModule } from "./tasks";

export async function bootstrapModules(): Promise<void> {
  await registry.register(coreChatModule);
  await registry.register(coreWalletModule);
  await registry.register(coreGovernanceModule);
  await registry.register(coreTasksModule);
}
