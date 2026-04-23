/**
 * Permission keys for the signed-module trust store.
 *
 * The trust store lives in `StateSettings.extras.trustedModulePublishers`
 * (a free-form JSONB column on `StateSettings`) and is managed through
 * Палата Указов once the UI lands. For now, the key is registered so
 * the Vertical editor surfaces it next to every other core permission.
 *
 * Shape (consumed by a future `POST /api/cli/modules/install-package`
 * and by the CLI's own fallback when the server-side path is wired):
 *
 *     {
 *       "trustedModulePublishers": [
 *         { "id": "krwnos.core", "pubKeyPem": "-----BEGIN PUBLIC KEY-----..." },
 *         ...
 *       ]
 *     }
 *
 * See `docs/DATABASE.md` and `docs/MODULE_GUIDE.md` — «Подпись и
 * распространение модулей».
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const ModuleTrustPermissions = {
  /** Add / remove / rotate publisher public keys in the State trust store. */
  Manage: "modules.trust.manage" as PermissionKey,
};

export const moduleTrustPermissionDescriptors: PermissionDescriptor[] = [
  {
    key: ModuleTrustPermissions.Manage,
    owner: "core",
    label: "Manage trusted module publishers",
    description:
      "Add, rotate, or revoke Ed25519 public keys used to verify signed `.krwn` packages before install.",
    // Gated under `system.admin` by default; the Palace of Decrees UI
    // may surface a separate review flow for delegated operators.
    sovereignOnly: true,
  },
];
