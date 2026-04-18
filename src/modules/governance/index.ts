/**
 * core.governance — «Парламент» KrwnOS.
 * ------------------------------------------------------------
 * Регистрирует четыре права (view / propose / vote / admin),
 * выставляет виджет "Парламент" в Dynamic UI и экспортирует
 * `GovernanceService` + Prisma-адаптер для HTTP-слоя.
 *
 * Ключевая идея модуля — гибридная DAO:
 *   * `decree`        — голосование выключено, только Суверен;
 *   * `consultation`  — граждане голосуют, Суверен решает;
 *   * `auto_dao`      — успех автоматически меняет конституцию.
 *
 * Формы правил и whitelist разрешённых `targetConfigKey` живут
 * в `@/core/governance-rules`. Модуль сознательно не дублирует
 * их копию — иначе рассинхрон между ядром и плагином.
 */

import type { KrwnModule } from "@/types/kernel";
import {
  GOVERNANCE_MODULE_SLUG,
  GovernancePermissions,
  governancePermissionDescriptors,
} from "./permissions";

export {
  GOVERNANCE_EVENTS,
  GovernanceError,
  GovernanceService,
  tallyProposal,
  type CastVoteInput,
  type CreateProposalInput,
  type CreateProposalRow,
  type GovernanceAccessContext,
  type GovernanceErrorCode,
  type GovernanceRepository,
  type GovernanceServiceDeps,
  type InsertVoteRow,
  type Proposal,
  type ProposalCancelledEvent,
  type ProposalClosedEvent,
  type ProposalCreatedEvent,
  type ProposalExecutedEvent,
  type ProposalListFilter,
  type ProposalStatus,
  type ProposalTally,
  type ProposalVetoedEvent,
  type Vote,
  type VoteCastEvent,
  type VoteChoice,
} from "./service";
export {
  GOVERNANCE_MODULE_SLUG,
  GovernancePermissions,
  governancePermissionDescriptors,
} from "./permissions";
export { createPrismaGovernanceRepository } from "./repo";

export const coreGovernanceModule: KrwnModule = {
  slug: GOVERNANCE_MODULE_SLUG,
  name: "Core Governance",
  version: "0.1.0",
  description:
    "Парламент KrwnOS: предложения, голосования и автоматическое " +
    "исполнение решений DAO. Работает поверх Палаты Указов — " +
    "граждане меняют только те параметры конституции, которые " +
    "Суверен явно отдал на откуп.",

  init() {
    return { permissions: governancePermissionDescriptors };
  },

  getWidget(ctx) {
    if (!ctx.permissions.has(GovernancePermissions.View) && !ctx.permissions.has("*")) {
      return null;
    }
    return {
      id: "parliament",
      title: "Парламент",
      component: null,
      requiredPermission: GovernancePermissions.View,
      defaultSize: "md",
    };
  },

  getSettings(ctx) {
    if (!ctx.permissions.has(GovernancePermissions.Admin) && !ctx.permissions.has("*")) {
      return null;
    }
    return {
      title: "Настройки Парламента",
      component: null,
      requiredPermission: GovernancePermissions.Admin,
    };
  },
};
