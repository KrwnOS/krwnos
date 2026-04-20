/**
 * Права ядра для операций с учётными данными (CLI scopes + Vertical editor).
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const CredentialsPermissions = {
  TelegramLink: "credentials.telegram.link" as PermissionKey,
};

export const credentialsPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: CredentialsPermissions.TelegramLink,
    owner: "core",
    label: "Link Telegram account",
    description:
      "Allows calling POST /api/telegram/link/start to issue a one-time deep link that binds this Telegram user id to the authenticated KrwnOS user.",
  },
];
