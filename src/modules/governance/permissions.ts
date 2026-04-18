/**
 * Canonical permission keys declared by the `core.governance` module.
 *
 * Модуль отвечает за «Парламент»: создание предложений,
 * голосование, исполнение решений и право вето. Четыре ключа:
 *   * `governance.view`     — читать ленту предложений и голосов.
 *                             По умолчанию открыто всем — законы
 *                             должны быть прозрачны (мы следуем
 *                             той же логике, что и `state.view_settings`).
 *   * `governance.propose`  — создавать предложения.
 *   * `governance.vote`     — голосовать.
 *   * `governance.admin`    — управлять ручным исполнением /
 *                             отменой в режиме `consultation`,
 *                             а также правом вето в DAO-режиме.
 *                             По спецификации — только Суверен,
 *                             но право делегируемо (например, на
 *                             «Парламентскую канцелярию»).
 */

import type { PermissionDescriptor, PermissionKey } from "@/types/kernel";

export const GovernancePermissions = {
  View: "governance.view" as PermissionKey,
  Propose: "governance.propose" as PermissionKey,
  Vote: "governance.vote" as PermissionKey,
  Admin: "governance.admin" as PermissionKey,
} as const;

export const GOVERNANCE_MODULE_SLUG = "core.governance";

export const governancePermissionDescriptors: PermissionDescriptor[] = [
  {
    key: GovernancePermissions.View,
    owner: GOVERNANCE_MODULE_SLUG,
    label: "Читать Парламент",
    description:
      "Видеть ленту предложений, результаты голосований и отчёты об " +
      "исполнении. По умолчанию выдано каждому гражданину.",
  },
  {
    key: GovernancePermissions.Propose,
    owner: GOVERNANCE_MODULE_SLUG,
    label: "Предлагать изменения",
    description:
      "Создавать предложения, меняющие параметры конституции (из " +
      "whitelist-а, заданного Сувереном в Палате Указов).",
  },
  {
    key: GovernancePermissions.Vote,
    owner: GOVERNANCE_MODULE_SLUG,
    label: "Голосовать",
    description:
      "Отдавать голос «за», «против» или «воздержаться» по активным " +
      "предложениям. Вес рассчитывается по стратегии, выбранной Сувереном.",
  },
  {
    key: GovernancePermissions.Admin,
    owner: GOVERNANCE_MODULE_SLUG,
    label: "Администрировать Парламент",
    description:
      "Вето на любое предложение, ручное исполнение/закрытие голосований " +
      "в режиме «Консультация», досрочная отмена. По умолчанию — Суверен.",
    sovereignOnly: false,
  },
];
