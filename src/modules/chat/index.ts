/**
 * core.chat — первый функциональный модуль KrwnOS.
 * ------------------------------------------------------------
 * Регистрирует три права: `chat.read`, `chat.write`, `chat.admin`,
 * выставляет виджет ленты для Dynamic UI и экспортирует
 * `ChatService` / `createPrismaChatRepository`, которыми пользуются
 * HTTP-роуты в `src/app/api/chat/*`.
 *
 * Канал может быть опционально привязан к `VerticalNode`. В этом
 * случае доступ проверяется Permissions Engine'ом — пользователь
 * должен быть членом этого узла или любого из его родителей.
 * Сообщения пробрасываются в realtime через `eventBus` (Redis
 * pub/sub в production).
 */

import type { KrwnModule } from "@/types/kernel";
import {
  CHAT_MODULE_SLUG,
  ChatPermissions,
  chatPermissionDescriptors,
} from "./permissions";

export {
  ChatAccessError,
  ChatService,
  CHAT_EVENTS,
  type ChannelAccessInfo,
  type ChannelAccessReason,
  type ChatAccessContext,
  type ChatChannel,
  type ChatDirectiveAck,
  type ChatDirectiveAckedEvent,
  type ChatMessage,
  type ChatMessageCreatedEvent,
  type ChatRepository,
  type ChatServiceDeps,
  type PendingDirective,
} from "./service";
export { ChatPermissions, CHAT_MODULE_SLUG } from "./permissions";
export { createPrismaChatRepository } from "./repo";

export const coreChatModule: KrwnModule = {
  slug: CHAT_MODULE_SLUG,
  name: "Core Chat",
  version: "0.1.0",
  description:
    "Встроенный чат Государства: каналы, сообщения и realtime-доставка " +
    "подписчикам. Поддерживает привязку каналов к узлам Вертикали.",

  init() {
    return { permissions: chatPermissionDescriptors };
  },

  getWidget(ctx) {
    if (!ctx.permissions.has(ChatPermissions.Read) && !ctx.permissions.has("*")) {
      return null;
    }
    return {
      id: "channels",
      title: "Чат",
      // Dynamic UI lazy-loads the actual component at render time.
      component: null,
      requiredPermission: ChatPermissions.Read,
      defaultSize: "lg",
    };
  },

  getSettings(ctx) {
    if (!ctx.permissions.has(ChatPermissions.Admin) && !ctx.permissions.has("*")) {
      return null;
    }
    return {
      title: "Настройки чата",
      component: null,
      requiredPermission: ChatPermissions.Admin,
    };
  },
};
