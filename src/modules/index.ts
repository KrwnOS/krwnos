/**
 * Module bootstrap.
 * ------------------------------------------------------------
 * The ONLY place where concrete plugins are wired into the
 * core Registry. Keep this list minimal and let each module
 * register its own permissions in its `init()` method.
 */

import { registry } from "@/core";
// import { coreChatModule } from "./core-chat";

export async function bootstrapModules(): Promise<void> {
  // await registry.register(coreChatModule);
}
