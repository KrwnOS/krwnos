/**
 * Canonical permission keys declared by the `core.chat` module.
 *
 * These strings are the source of truth — the module registers
 * them at `init()` time; routes and UI refer to them via these
 * constants to avoid typos.
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const ChatPermissions = {
  Read: "chat.read" as PermissionKey,
  Write: "chat.write" as PermissionKey,
  Admin: "chat.admin" as PermissionKey,
} as const;

export const CHAT_MODULE_SLUG = "core.chat";

export const chatPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: ChatPermissions.Read,
    owner: CHAT_MODULE_SLUG,
    label: "Читать сообщения",
    description:
      "Разрешает видеть каналы и читать сообщения. Для каналов, " +
      "привязанных к узлу Вертикали, дополнительно требуется членство " +
      "в этом узле или в одном из его родителей.",
  },
  {
    key: ChatPermissions.Write,
    owner: CHAT_MODULE_SLUG,
    label: "Отправлять сообщения",
    description:
      "Разрешает публиковать сообщения в каналах, к которым у " +
      "пользователя есть доступ на чтение.",
  },
  {
    key: ChatPermissions.Admin,
    owner: CHAT_MODULE_SLUG,
    label: "Администрировать чат",
    description:
      "Создание и архивация каналов, привязка каналов к узлам " +
      "Вертикали, модерация сообщений.",
  },
];
