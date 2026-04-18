/**
 * GovernanceService — сердце модуля `core.governance`.
 * ------------------------------------------------------------
 * Framework-agnostic: сервис не знает про Next.js, Prisma или
 * Redis. Всё пробрасывается снаружи:
 *
 *   * `GovernanceRepository` — persistence (в проде — Prisma,
 *     в тестах — in-memory fake).
 *   * `StateConfigService`   — читаем актуальные
 *     `governanceRules`, а Executor через него применяет успешные
 *     предложения. Это позволяет модулю не знать о форме
 *     конкретных полей конституции.
 *   * `PermissionsEngine` + `VerticalSnapshot` — кто может
 *     предлагать / голосовать / вето.
 *   * `ModuleEventBus`       — realtime-оповещение UI.
 *
 * Жизненный цикл предложения:
 *
 *   active ──▶ passed ──▶ executed            (auto_dao + успех)
 *          ─▶ passed ──▶ vetoed               (sovereignVeto после успеха)
 *          ─▶ rejected                        (fail quorum/threshold)
 *          ─▶ vetoed                          (veto до закрытия)
 *          ─▶ cancelled                       (создатель отозвал)
 *          ─▶ expired                         (ни одного голоса)
 *
 * В режиме `consultation` сервис НЕ дергает StateConfigService
 * автоматически — Суверен принимает решение вручную через
 * `execute()` или `veto()`.
 *
 * Канонические события:
 *   * "core.governance.proposal.created"
 *   * "core.governance.proposal.vote_cast"
 *   * "core.governance.proposal.closed"   (passed / rejected / expired)
 *   * "core.governance.proposal.executed"
 *   * "core.governance.proposal.vetoed"
 *   * "core.governance.proposal.cancelled"
 */

import { permissionsEngine, type PermissionsEngine } from "@/core/permissions-engine";
import {
  StateConfigError,
  type StateConfigAccessContext,
  type StateConfigService,
} from "@/core/state-config";
import {
  GOVERNANCE_MANAGEABLE_KEYS,
  isGovernanceManageableKey,
  resolveAllowedKeys,
  type GovernanceManageableKey,
  type GovernanceMode,
  type GovernanceRules,
  type WeightStrategy,
} from "@/core/governance-rules";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalSnapshot,
} from "@/types/kernel";
import { GovernancePermissions } from "./permissions";

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

export type ProposalStatus =
  | "active"
  | "passed"
  | "rejected"
  | "executed"
  | "vetoed"
  | "cancelled"
  | "expired";

export type VoteChoice = "for" | "against" | "abstain";

/** Persisted wire-shape — repos always return this exact form. */
export interface Proposal {
  id: string;
  stateId: string;
  createdById: string;
  title: string;
  description: string;
  targetConfigKey: GovernanceManageableKey;
  newValue: unknown;
  status: ProposalStatus;

  // Snapshot rules at creation time.
  quorumBps: number;
  thresholdBps: number;
  weightStrategy: WeightStrategy;
  modeAtCreation: GovernanceMode;
  sovereignVetoAtCreation: boolean;

  totalWeightFor: number;
  totalWeightAgainst: number;
  totalWeightAbstain: number;
  voteCount: number;

  executedById: string | null;
  vetoedById: string | null;
  vetoReason: string | null;

  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
  executedAt: Date | null;

  metadata: Record<string, unknown>;
}

export interface Vote {
  id: string;
  proposalId: string;
  stateId: string;
  userId: string;
  choice: VoteChoice;
  weight: number;
  weightReason: string;
  comment: string | null;
  createdAt: Date;
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

export const GOVERNANCE_EVENTS = {
  Created: "core.governance.proposal.created",
  VoteCast: "core.governance.proposal.vote_cast",
  Closed: "core.governance.proposal.closed",
  Executed: "core.governance.proposal.executed",
  Vetoed: "core.governance.proposal.vetoed",
  Cancelled: "core.governance.proposal.cancelled",
} as const;

export interface ProposalCreatedEvent {
  stateId: string;
  proposalId: string;
  createdById: string;
  targetConfigKey: GovernanceManageableKey;
}

export interface VoteCastEvent {
  stateId: string;
  proposalId: string;
  userId: string;
  choice: VoteChoice;
  weight: number;
  voteCount: number;
  totals: {
    for: number;
    against: number;
    abstain: number;
  };
}

export interface ProposalClosedEvent {
  stateId: string;
  proposalId: string;
  status: ProposalStatus;
  tally: ProposalTally;
}

export interface ProposalExecutedEvent {
  stateId: string;
  proposalId: string;
  appliedBy: string;
  key: GovernanceManageableKey;
  value: unknown;
}

export interface ProposalVetoedEvent {
  stateId: string;
  proposalId: string;
  vetoedById: string;
  reason: string | null;
}

export interface ProposalCancelledEvent {
  stateId: string;
  proposalId: string;
  cancelledById: string;
}

// ------------------------------------------------------------
// Repository contract
// ------------------------------------------------------------

export interface CreateProposalRow {
  stateId: string;
  createdById: string;
  title: string;
  description: string;
  targetConfigKey: GovernanceManageableKey;
  newValue: unknown;
  quorumBps: number;
  thresholdBps: number;
  weightStrategy: WeightStrategy;
  modeAtCreation: GovernanceMode;
  sovereignVetoAtCreation: boolean;
  expiresAt: Date;
}

export interface InsertVoteRow {
  proposalId: string;
  stateId: string;
  userId: string;
  choice: VoteChoice;
  weight: number;
  weightReason: string;
  comment: string | null;
}

export interface ProposalListFilter {
  stateId: string;
  status?: ProposalStatus[];
  limit?: number;
}

export interface GovernanceRepository {
  createProposal(row: CreateProposalRow): Promise<Proposal>;
  findProposal(proposalId: string): Promise<Proposal | null>;
  listProposals(filter: ProposalListFilter): Promise<Proposal[]>;
  updateProposalStatus(
    proposalId: string,
    patch: {
      status: ProposalStatus;
      closedAt?: Date | null;
      executedAt?: Date | null;
      executedById?: string | null;
      vetoedById?: string | null;
      vetoReason?: string | null;
    },
  ): Promise<Proposal>;

  /**
   * Вставляет голос и атомарно пересчитывает агрегаты
   * `totalWeightFor / Against / Abstain` + `voteCount` на том же
   * Proposal. Возвращает (новый голос, обновлённый Proposal).
   * Должно бросать ошибку на конфликте по `@@unique([proposalId, userId])`.
   */
  insertVote(
    row: InsertVoteRow,
  ): Promise<{ vote: Vote; proposal: Proposal }>;

  /** Считает голоса для финального tally (не обязательно по одному узлу — в будущем для by_balance). */
  findVote(proposalId: string, userId: string): Promise<Vote | null>;

  listVotes(proposalId: string): Promise<Vote[]>;

  /**
   * Размер электората — сколько «голосов» могло бы быть подано
   * максимум при выбранной `WeightStrategy`. Используется при
   * расчёте кворума. Реализация Prisma-адаптера:
   *   * one_person_one_vote → COUNT(Membership WHERE status='active' AND node.stateId = X).
   *   * by_node_weight      → Σ max(nodeWeights[nodeId] для узлов пользователя).
   *   * by_balance          → Σ balance(primary asset) по всем кошелькам state.
   */
  electorateSize(
    stateId: string,
    strategy: WeightStrategy,
    nodeWeights: Record<string, number>,
    balanceAssetId: string | null,
  ): Promise<number>;

  /**
   * Возвращает балан user-а primary-валюты (или указанного asset-а)
   * для стратегии by_balance. Сервис считает только balance у
   * PERSONAL-кошелька (treasury-бюджеты не голосуют).
   */
  balanceOf(
    stateId: string,
    userId: string,
    balanceAssetId: string | null,
  ): Promise<number>;

  /** id «primary» StateAsset — нужен как default для by_balance. */
  primaryAssetId(stateId: string): Promise<string | null>;

  /** id узлов, в которых user активно состоит (кэшируется снаружи при необходимости). */
  userNodeIds(stateId: string, userId: string): Promise<string[]>;

  /** Proposal-ы, у которых `expiresAt <= now` и `status = 'active'`. */
  listDueProposals(now: Date): Promise<Proposal[]>;
}

// ------------------------------------------------------------
// Access context + errors
// ------------------------------------------------------------

export interface GovernanceAccessContext {
  userId: string;
  isOwner: boolean;
  snapshot: VerticalSnapshot;
  permissions: ReadonlySet<PermissionKey>;
}

export type GovernanceErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "closed";

export class GovernanceError extends Error {
  constructor(
    message: string,
    public readonly code: GovernanceErrorCode,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

// ------------------------------------------------------------
// Tally helper (pure)
// ------------------------------------------------------------

export interface ProposalTally {
  forWeight: number;
  againstWeight: number;
  abstainWeight: number;
  totalCastWeight: number;
  voteCount: number;
  quorumReached: boolean;
  thresholdReached: boolean;
  willPass: boolean;
  /** Размер электората, с которым сравнивается кворум. */
  electorateSize: number;
}

export function tallyProposal(
  proposal: Pick<
    Proposal,
    | "totalWeightFor"
    | "totalWeightAgainst"
    | "totalWeightAbstain"
    | "voteCount"
    | "quorumBps"
    | "thresholdBps"
  >,
  electorateSize: number,
): ProposalTally {
  const totalCastWeight =
    proposal.totalWeightFor +
    proposal.totalWeightAgainst +
    proposal.totalWeightAbstain;

  const quorumRequirement = (electorateSize * proposal.quorumBps) / 10_000;
  const quorumReached =
    electorateSize <= 0 ? false : totalCastWeight >= quorumRequirement;

  const decisionBase = proposal.totalWeightFor + proposal.totalWeightAgainst;
  const thresholdReached =
    decisionBase <= 0
      ? false
      : proposal.totalWeightFor / decisionBase >=
        proposal.thresholdBps / 10_000;

  return {
    forWeight: proposal.totalWeightFor,
    againstWeight: proposal.totalWeightAgainst,
    abstainWeight: proposal.totalWeightAbstain,
    totalCastWeight,
    voteCount: proposal.voteCount,
    quorumReached,
    thresholdReached,
    willPass: quorumReached && thresholdReached,
    electorateSize,
  };
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface GovernanceServiceDeps {
  repo: GovernanceRepository;
  stateConfig: StateConfigService;
  bus: ModuleEventBus;
  engine?: PermissionsEngine;
  /** Переопределяется в тестах (fake clock). */
  now?: () => Date;
}

export interface CreateProposalInput {
  title: string;
  description: string;
  targetConfigKey: string;
  newValue: unknown;
}

export interface CastVoteInput {
  choice: VoteChoice;
  comment?: string | null;
}

export class GovernanceService {
  private readonly repo: GovernanceRepository;
  private readonly stateConfig: StateConfigService;
  private readonly bus: ModuleEventBus;
  private readonly engine: PermissionsEngine;
  private readonly now: () => Date;

  constructor(deps: GovernanceServiceDeps) {
    this.repo = deps.repo;
    this.stateConfig = deps.stateConfig;
    this.bus = deps.bus;
    this.engine = deps.engine ?? permissionsEngine;
    this.now = deps.now ?? (() => new Date());
  }

  // --------------------------------------------------------
  // Read
  // --------------------------------------------------------

  async getRules(stateId: string): Promise<GovernanceRules> {
    const settings = await this.stateConfig.get(stateId);
    return settings.governanceRules;
  }

  async listProposals(
    stateId: string,
    ctx: GovernanceAccessContext,
    filter?: { status?: ProposalStatus[]; limit?: number },
  ): Promise<Proposal[]> {
    this.requirePermission(ctx, GovernancePermissions.View);
    return this.repo.listProposals({
      stateId,
      status: filter?.status,
      limit: filter?.limit ?? 100,
    });
  }

  async getProposal(
    proposalId: string,
    ctx: GovernanceAccessContext,
  ): Promise<{ proposal: Proposal; votes: Vote[]; tally: ProposalTally }> {
    this.requirePermission(ctx, GovernancePermissions.View);
    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) {
      throw new GovernanceError("Proposal not found.", "not_found");
    }
    const [votes, rules] = await Promise.all([
      this.repo.listVotes(proposalId),
      this.getRules(proposal.stateId),
    ]);
    const balanceAssetId =
      rules.balanceAssetId ??
      (await this.repo.primaryAssetId(proposal.stateId));
    const electorate = await this.repo.electorateSize(
      proposal.stateId,
      proposal.weightStrategy,
      rules.nodeWeights,
      balanceAssetId,
    );
    return { proposal, votes, tally: tallyProposal(proposal, electorate) };
  }

  // --------------------------------------------------------
  // Create proposal
  // --------------------------------------------------------

  async createProposal(
    stateId: string,
    ctx: GovernanceAccessContext,
    input: CreateProposalInput,
  ): Promise<Proposal> {
    this.requirePermission(ctx, GovernancePermissions.Propose);

    const title = input.title.trim();
    const description = input.description.trim();
    if (title.length < 3 || title.length > 200) {
      throw new GovernanceError(
        "Title must be between 3 and 200 characters.",
        "invalid_input",
      );
    }
    if (description.length === 0 || description.length > 8000) {
      throw new GovernanceError(
        "Description must be between 1 and 8000 characters.",
        "invalid_input",
      );
    }

    if (!isGovernanceManageableKey(input.targetConfigKey)) {
      throw new GovernanceError(
        `Unknown or non-manageable config key "${input.targetConfigKey}". ` +
          `Allowed by core: ${GOVERNANCE_MANAGEABLE_KEYS.join(", ")}.`,
        "invalid_input",
      );
    }

    const rules = await this.getRules(stateId);

    if (rules.mode === "decree" && !ctx.isOwner) {
      throw new GovernanceError(
        "Parliament is in Decree mode — only the Sovereign may create proposals.",
        "forbidden",
      );
    }

    const allowed = resolveAllowedKeys(rules);
    if (!allowed.has(input.targetConfigKey)) {
      throw new GovernanceError(
        `Config key "${input.targetConfigKey}" is not on the DAO whitelist. ` +
          `Ask the Sovereign to allow it in /admin/constitution.`,
        "forbidden",
      );
    }

    if (rules.minProposerPermission && !ctx.isOwner) {
      if (!hasPermission(ctx.permissions, rules.minProposerPermission as PermissionKey)) {
        throw new GovernanceError(
          `Proposer must hold "${rules.minProposerPermission}".`,
          "forbidden",
        );
      }
    }

    if (rules.minProposerBalance != null && rules.minProposerBalance > 0 && !ctx.isOwner) {
      const balance = await this.repo.balanceOf(stateId, ctx.userId, rules.balanceAssetId);
      if (balance < rules.minProposerBalance) {
        throw new GovernanceError(
          `Proposer balance below minimum (${rules.minProposerBalance}).`,
          "forbidden",
        );
      }
    }

    validateNewValueShape(input.targetConfigKey, input.newValue);

    const now = this.now();
    const expiresAt = new Date(
      now.getTime() + rules.votingDurationSeconds * 1000,
    );

    const proposal = await this.repo.createProposal({
      stateId,
      createdById: ctx.userId,
      title,
      description,
      targetConfigKey: input.targetConfigKey,
      newValue: input.newValue,
      quorumBps: rules.quorumBps,
      thresholdBps: rules.thresholdBps,
      weightStrategy: rules.weightStrategy,
      modeAtCreation: rules.mode,
      sovereignVetoAtCreation: rules.sovereignVeto,
      expiresAt,
    });

    void this.bus
      .emit<ProposalCreatedEvent>(GOVERNANCE_EVENTS.Created, {
        stateId,
        proposalId: proposal.id,
        createdById: ctx.userId,
        targetConfigKey: proposal.targetConfigKey,
      })
      .catch(() => {});

    return proposal;
  }

  // --------------------------------------------------------
  // Cast vote
  // --------------------------------------------------------

  async castVote(
    proposalId: string,
    ctx: GovernanceAccessContext,
    input: CastVoteInput,
  ): Promise<{ vote: Vote; proposal: Proposal }> {
    this.requirePermission(ctx, GovernancePermissions.Vote);

    if (!isVoteChoice(input.choice)) {
      throw new GovernanceError("Invalid vote choice.", "invalid_input");
    }
    const comment = input.comment?.trim() || null;
    if (comment && comment.length > 2000) {
      throw new GovernanceError("Comment too long.", "invalid_input");
    }

    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) throw new GovernanceError("Proposal not found.", "not_found");
    if (proposal.status !== "active") {
      throw new GovernanceError(
        `Voting is closed (status = ${proposal.status}).`,
        "closed",
      );
    }
    if (proposal.expiresAt <= this.now()) {
      // Ленивый auto-close — не ждём cron, чтобы голос «за секунду
      // до дедлайна» сразу закрывал голосование при следующем запросе.
      await this.closeAndMaybeExecute(proposal.id);
      throw new GovernanceError("Proposal has expired.", "closed");
    }

    // --- compute weight ---
    const rules = await this.getRules(proposal.stateId);
    const weight = await this.computeVoteWeight(
      proposal.stateId,
      ctx,
      proposal.weightStrategy,
      rules,
    );
    if (weight <= 0) {
      throw new GovernanceError(
        "You have zero effective voting weight.",
        "forbidden",
      );
    }

    try {
      const res = await this.repo.insertVote({
        proposalId,
        stateId: proposal.stateId,
        userId: ctx.userId,
        choice: input.choice,
        weight,
        weightReason: proposal.weightStrategy,
        comment,
      });

      void this.bus
        .emit<VoteCastEvent>(GOVERNANCE_EVENTS.VoteCast, {
          stateId: proposal.stateId,
          proposalId,
          userId: ctx.userId,
          choice: input.choice,
          weight,
          voteCount: res.proposal.voteCount,
          totals: {
            for: res.proposal.totalWeightFor,
            against: res.proposal.totalWeightAgainst,
            abstain: res.proposal.totalWeightAbstain,
          },
        })
        .catch(() => {});

      return res;
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new GovernanceError(
          "You have already voted on this proposal.",
          "conflict",
        );
      }
      throw err;
    }
  }

  // --------------------------------------------------------
  // Lifecycle: close, execute, veto, cancel
  // --------------------------------------------------------

  /**
   * Идемпотентный «тик» Executor-а: если голосование просрочено
   * или закрыто по решению и mode=auto_dao, применяет изменения.
   * В `consultation` — только закрывает, ждёт ручного execute/veto.
   * Может быть вызван из cron, из UI или при каждом fetch
   * предложения.
   */
  async closeAndMaybeExecute(proposalId: string): Promise<Proposal> {
    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) throw new GovernanceError("Proposal not found.", "not_found");
    if (proposal.status !== "active") return proposal;
    if (proposal.expiresAt > this.now()) {
      return proposal; // Ещё не время.
    }

    const tally = await this.computeTally(proposal);

    let nextStatus: ProposalStatus;
    if (proposal.voteCount === 0) {
      nextStatus = "expired";
    } else {
      nextStatus = tally.willPass ? "passed" : "rejected";
    }

    const closed = await this.repo.updateProposalStatus(proposal.id, {
      status: nextStatus,
      closedAt: this.now(),
    });

    void this.bus
      .emit<ProposalClosedEvent>(GOVERNANCE_EVENTS.Closed, {
        stateId: proposal.stateId,
        proposalId: proposal.id,
        status: nextStatus,
        tally,
      })
      .catch(() => {});

    if (nextStatus === "passed" && proposal.modeAtCreation === "auto_dao") {
      return this.autoExecute(closed);
    }
    return closed;
  }

  /**
   * Ручное исполнение — для `consultation` mode. Только
   * `governance.admin` (или Суверен). Переводит passed → executed,
   * применяя `newValue` к `StateSettings`.
   */
  async execute(
    proposalId: string,
    ctx: GovernanceAccessContext,
  ): Promise<Proposal> {
    this.requirePermission(ctx, GovernancePermissions.Admin);
    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) throw new GovernanceError("Proposal not found.", "not_found");
    if (proposal.status !== "passed") {
      throw new GovernanceError(
        `Only passed proposals can be executed (got ${proposal.status}).`,
        "closed",
      );
    }
    return this.applyAndMark(proposal, ctx.userId, {
      sovereignContext: ctx,
    });
  }

  /**
   * Вето. Возможно в активном статусе, в статусе `passed` и даже
   * после `executed`? Нет — исполненное решение откатить нельзя:
   * это требует нового предложения. Вето доступно только до
   * исполнения. Требует `sovereignVeto = true` либо напрямую
   * `isOwner` (Суверен).
   */
  async veto(
    proposalId: string,
    ctx: GovernanceAccessContext,
    opts: { reason?: string | null } = {},
  ): Promise<Proposal> {
    this.requirePermission(ctx, GovernancePermissions.Admin);
    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) throw new GovernanceError("Proposal not found.", "not_found");

    if (!proposal.sovereignVetoAtCreation && !ctx.isOwner) {
      throw new GovernanceError(
        "Veto is disabled for this proposal.",
        "forbidden",
      );
    }
    if (proposal.status === "executed") {
      throw new GovernanceError(
        "Cannot veto an already-executed proposal. Issue a reverse proposal instead.",
        "conflict",
      );
    }
    if (
      proposal.status === "vetoed" ||
      proposal.status === "cancelled" ||
      proposal.status === "rejected" ||
      proposal.status === "expired"
    ) {
      throw new GovernanceError(
        `Proposal already closed with status=${proposal.status}.`,
        "closed",
      );
    }

    const reason = opts.reason?.trim() || null;
    const vetoed = await this.repo.updateProposalStatus(proposalId, {
      status: "vetoed",
      closedAt: this.now(),
      vetoedById: ctx.userId,
      vetoReason: reason,
    });

    void this.bus
      .emit<ProposalVetoedEvent>(GOVERNANCE_EVENTS.Vetoed, {
        stateId: proposal.stateId,
        proposalId,
        vetoedById: ctx.userId,
        reason,
      })
      .catch(() => {});

    return vetoed;
  }

  async cancel(
    proposalId: string,
    ctx: GovernanceAccessContext,
  ): Promise<Proposal> {
    this.requirePermission(ctx, GovernancePermissions.View);
    const proposal = await this.repo.findProposal(proposalId);
    if (!proposal) throw new GovernanceError("Proposal not found.", "not_found");
    const isAuthor = proposal.createdById === ctx.userId;
    const canAdmin = ctx.isOwner || hasPermission(ctx.permissions, GovernancePermissions.Admin);
    if (!isAuthor && !canAdmin) {
      throw new GovernanceError(
        "Only the author or a governance admin can cancel a proposal.",
        "forbidden",
      );
    }
    if (proposal.status !== "active") {
      throw new GovernanceError(
        `Cannot cancel a ${proposal.status} proposal.`,
        "closed",
      );
    }
    const cancelled = await this.repo.updateProposalStatus(proposalId, {
      status: "cancelled",
      closedAt: this.now(),
    });
    void this.bus
      .emit<ProposalCancelledEvent>(GOVERNANCE_EVENTS.Cancelled, {
        stateId: proposal.stateId,
        proposalId,
        cancelledById: ctx.userId,
      })
      .catch(() => {});
    return cancelled;
  }

  /**
   * Пытается закрыть все просроченные предложения. Удобно для
   * cron / watchdog-а; возвращает список реально закрытых.
   */
  async tickDueProposals(): Promise<Proposal[]> {
    const due = await this.repo.listDueProposals(this.now());
    const results: Proposal[] = [];
    for (const p of due) {
      try {
        const next = await this.closeAndMaybeExecute(p.id);
        results.push(next);
      } catch {
        // Пропускаем одну зависшую строку, чтобы не ронять весь цикл.
      }
    }
    return results;
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  private async computeTally(proposal: Proposal): Promise<ProposalTally> {
    const rules = await this.getRules(proposal.stateId);
    const balanceAssetId =
      rules.balanceAssetId ?? (await this.repo.primaryAssetId(proposal.stateId));
    const electorate = await this.repo.electorateSize(
      proposal.stateId,
      proposal.weightStrategy,
      rules.nodeWeights,
      balanceAssetId,
    );
    return tallyProposal(proposal, electorate);
  }

  private async autoExecute(proposal: Proposal): Promise<Proposal> {
    return this.applyAndMark(proposal, "system:auto_dao", {
      sovereignContext: null,
    });
  }

  /**
   * Делает три вещи атомарно-достаточно (одна запись в Proposal +
   * одна в StateSettings — разные таблицы, но read-after-write
   * консистентность не требуется для audit):
   *   1. Запускает `StateConfigService.update()` с правами Суверена
   *      от имени «системы». Это самый тонкий момент: Executor
   *      должен иметь право писать конституцию. Мы передаём
   *      синтезированный `access` с пометкой `isOwner=true`, но
   *      сохраняем реального инициатора в `executedById`. Для ручного
   *      режима передаётся реальный ctx.
   *   2. Помечает Proposal как `executed`.
   *   3. Публикует событие.
   */
  private async applyAndMark(
    proposal: Proposal,
    executedById: string,
    opts: { sovereignContext: GovernanceAccessContext | null },
  ): Promise<Proposal> {
    const access: StateConfigAccessContext = opts.sovereignContext
      ? {
          userId: opts.sovereignContext.userId,
          isOwner: opts.sovereignContext.isOwner,
          permissions: opts.sovereignContext.permissions,
        }
      : {
          // Executor в auto_dao-режиме действует «от имени
          // конституции». Мы НЕ эскалируем до Sovereign-а
          // (isOwner=false) — вместо этого даём синтетическому
          // актёру набор `state.configure`, потому что именно этот
          // ключ проверяет StateConfigService. `executedById`
          // сохранит реального инициатора для audit-события.
          userId: executedById,
          isOwner: false,
          permissions: new Set<PermissionKey>(["state.configure"]),
        };

    const patch = buildSettingsPatch(proposal.targetConfigKey, proposal.newValue);

    try {
      await this.stateConfig.update(proposal.stateId, access, patch);
    } catch (err) {
      // Если StateConfigService отказал (валидация), переводим
      // предложение в `rejected`, а не в `executed` — это спасает
      // audit trail и явно сигналит UI, что Executor не смог.
      if (err instanceof StateConfigError) {
        const rejected = await this.repo.updateProposalStatus(proposal.id, {
          status: "rejected",
          closedAt: this.now(),
        });
        return rejected;
      }
      throw err;
    }

    const executed = await this.repo.updateProposalStatus(proposal.id, {
      status: "executed",
      closedAt: proposal.closedAt ?? this.now(),
      executedAt: this.now(),
      executedById,
    });

    void this.bus
      .emit<ProposalExecutedEvent>(GOVERNANCE_EVENTS.Executed, {
        stateId: proposal.stateId,
        proposalId: proposal.id,
        appliedBy: executedById,
        key: proposal.targetConfigKey,
        value: proposal.newValue,
      })
      .catch(() => {});

    return executed;
  }

  private async computeVoteWeight(
    stateId: string,
    ctx: GovernanceAccessContext,
    strategy: WeightStrategy,
    rules: GovernanceRules,
  ): Promise<number> {
    if (strategy === "one_person_one_vote") {
      // Проверяем, что у пользователя есть ЛЮБОЕ активное членство.
      // Сувереном в `one_person_one_vote` засчитываем как 1 голос.
      if (ctx.isOwner) return 1;
      const nodes = await this.repo.userNodeIds(stateId, ctx.userId);
      return nodes.length > 0 ? 1 : 0;
    }
    if (strategy === "by_node_weight") {
      const nodes = await this.repo.userNodeIds(stateId, ctx.userId);
      if (ctx.isOwner && nodes.length === 0) return 1;
      let best = 0;
      for (const nodeId of nodes) {
        const w = rules.nodeWeights[nodeId] ?? 1;
        if (w > best) best = w;
      }
      return best;
    }
    if (strategy === "by_balance") {
      const balance = await this.repo.balanceOf(
        stateId,
        ctx.userId,
        rules.balanceAssetId,
      );
      return balance > 0 ? balance : 0;
    }
    return 0;
  }

  private requirePermission(
    ctx: GovernanceAccessContext,
    key: PermissionKey,
  ): void {
    if (ctx.isOwner) return;
    if (!hasPermission(ctx.permissions, key)) {
      throw new GovernanceError(`Missing permission "${key}".`, "forbidden");
    }
  }
}

// ------------------------------------------------------------
// Pure helpers (exported for tests)
// ------------------------------------------------------------

function hasPermission(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}

function isVoteChoice(x: unknown): x is VoteChoice {
  return x === "for" || x === "against" || x === "abstain";
}

/**
 * Грубая pre-валидация `newValue` по типу, ожидаемому колонкой
 * `StateSettings`. Финальная семантическая проверка делается
 * самим `StateConfigService.update()` — здесь мы просто отсекаем
 * очевидно сломанный ввод, чтобы голосования не висели ради
 * пустой траты сил.
 */
function validateNewValueShape(
  key: GovernanceManageableKey,
  value: unknown,
): void {
  switch (key) {
    case "transactionTaxRate":
    case "incomeTaxRate":
    case "roleTaxRate":
    case "exitRefundRate": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new GovernanceError(
          `"${key}" must be a number in [0, 1].`,
          "invalid_input",
        );
      }
      return;
    }
    case "citizenshipFeeAmount":
    case "autoPromotionMinBalance": {
      if (value === null) return;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new GovernanceError(
          `"${key}" must be a non-negative number or null.`,
          "invalid_input",
        );
      }
      return;
    }
    case "autoPromotionMinDays": {
      if (value === null) return;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 36_500
      ) {
        throw new GovernanceError(
          `"${key}" must be an integer in [0, 36500] or null.`,
          "invalid_input",
        );
      }
      return;
    }
    case "rolesPurchasable":
    case "permissionInheritance":
    case "autoPromotionEnabled": {
      if (typeof value !== "boolean") {
        throw new GovernanceError(
          `"${key}" must be a boolean.`,
          "invalid_input",
        );
      }
      return;
    }
    case "currencyDisplayName":
    case "autoPromotionTargetNodeId": {
      if (value === null) return;
      if (typeof value !== "string" || value.length > 64) {
        throw new GovernanceError(
          `"${key}" must be a string (≤ 64 chars) or null.`,
          "invalid_input",
        );
      }
      return;
    }
    case "treasuryTransparency": {
      if (value !== "public" && value !== "council" && value !== "sovereign") {
        throw new GovernanceError(
          `"${key}" must be one of public|council|sovereign.`,
          "invalid_input",
        );
      }
      return;
    }
    default: {
      // Should be unreachable given isGovernanceManageableKey narrowing.
      throw new GovernanceError(`Unsupported key "${key}".`, "invalid_input");
    }
  }
}

function buildSettingsPatch(
  key: GovernanceManageableKey,
  value: unknown,
): Record<string, unknown> {
  // Прямой mapping: имена ключей в `StateSettings` совпадают с
  // `GovernanceManageableKey`. Сознательно не используем `as any`
  // — дальше это будет проверено StateConfigService.validatePatch.
  return { [key]: value };
}
