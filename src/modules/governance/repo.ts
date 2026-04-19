/**
 * Prisma adapter for `GovernanceRepository`.
 * ------------------------------------------------------------
 * Единственный мост между `GovernanceService` и БД. Тесты
 * подкладывают in-memory fake через тот же контракт.
 *
 * Важное свойство `insertVote`: вставка голоса и пересчёт
 * агрегатов идут в ОДНОЙ транзакции, чтобы счётчики не
 * разъезжались при конкурентных запросах. Conflict по
 * `@@unique([proposalId, userId])` бросается наружу — сервис
 * превращает его в `GovernanceError("conflict")`.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";
import { ledgerDecimal } from "@/modules/wallet/money";
import type {
  CreateProposalRow,
  GovernanceRepository,
  InsertVoteRow,
  Proposal,
  ProposalListFilter,
  ProposalStatus,
  Vote,
  VoteChoice,
} from "./service";
import type { GovernanceManageableKey } from "@/core/governance-rules";
import { isGovernanceManageableKey } from "@/core/governance-rules";
import type { WeightStrategy } from "@/core/governance-rules";

// Loose delegate shapes — сгенерированный Prisma-клиент может
// отставать от миграции (например, во время bootstrap). Мы
// касаемся только тех методов, что реально нужны.
type LooseTableDelegate = {
  create: (args: unknown) => Promise<unknown>;
  findUnique: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  count: (args?: unknown) => Promise<number>;
};

type LooseTxClient = {
  proposal: LooseTableDelegate;
  vote: LooseTableDelegate;
  membership: LooseTableDelegate;
  wallet: LooseTableDelegate;
  stateAsset: LooseTableDelegate;
};

type LooseClient = LooseTxClient & {
  $transaction: <T>(fn: (tx: LooseTxClient) => Promise<T>) => Promise<T>;
};

// ------------------------------------------------------------
// Row shapes (what Prisma returns). Kept permissive; mappers
// narrow back to the public `Proposal` / `Vote` types.
// ------------------------------------------------------------

interface PrismaProposalRow {
  id: string;
  stateId: string;
  createdById: string;
  title: string;
  description: string;
  targetConfigKey: string;
  newValue: unknown;
  status: ProposalStatus;
  quorumBps: number;
  thresholdBps: number;
  weightStrategy: string;
  modeAtCreation: string;
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
  metadata: unknown;
}

interface PrismaVoteRow {
  id: string;
  proposalId: string;
  stateId: string;
  userId: string;
  // Prisma enum: 'for_' | 'against' | 'abstain' — превращаем в wire
  choice: "for_" | "against" | "abstain";
  weight: number;
  weightReason: string;
  comment: string | null;
  createdAt: Date;
}

// ------------------------------------------------------------

export function createPrismaGovernanceRepository(
  prisma: PrismaClient,
): GovernanceRepository {
  const loose = prisma as unknown as LooseClient;

  return {
    async createProposal(row: CreateProposalRow): Promise<Proposal> {
      const created = (await loose.proposal.create({
        data: {
          stateId: row.stateId,
          createdById: row.createdById,
          title: row.title,
          description: row.description,
          targetConfigKey: row.targetConfigKey,
          newValue: row.newValue as Prisma.InputJsonValue,
          quorumBps: row.quorumBps,
          thresholdBps: row.thresholdBps,
          weightStrategy: row.weightStrategy,
          modeAtCreation: row.modeAtCreation,
          sovereignVetoAtCreation: row.sovereignVetoAtCreation,
          expiresAt: row.expiresAt,
        },
      })) as PrismaProposalRow;
      return mapProposal(created);
    },

    async findProposal(proposalId: string): Promise<Proposal | null> {
      const row = (await loose.proposal.findUnique({
        where: { id: proposalId },
      })) as PrismaProposalRow | null;
      return row ? mapProposal(row) : null;
    },

    async listProposals(filter: ProposalListFilter): Promise<Proposal[]> {
      const rows = (await loose.proposal.findMany({
        where: {
          stateId: filter.stateId,
          ...(filter.status && filter.status.length > 0
            ? { status: { in: filter.status } }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? 100,
      })) as PrismaProposalRow[];
      return rows.map(mapProposal);
    },

    async updateProposalStatus(proposalId, patch): Promise<Proposal> {
      const row = (await loose.proposal.update({
        where: { id: proposalId },
        data: {
          status: patch.status,
          ...(patch.closedAt !== undefined ? { closedAt: patch.closedAt } : {}),
          ...(patch.executedAt !== undefined
            ? { executedAt: patch.executedAt }
            : {}),
          ...(patch.executedById !== undefined
            ? { executedById: patch.executedById }
            : {}),
          ...(patch.vetoedById !== undefined
            ? { vetoedById: patch.vetoedById }
            : {}),
          ...(patch.vetoReason !== undefined
            ? { vetoReason: patch.vetoReason }
            : {}),
        },
      })) as PrismaProposalRow;
      return mapProposal(row);
    },

    async insertVote(row: InsertVoteRow) {
      return loose.$transaction(async (tx: LooseTxClient) => {
        // Вставка голоса — упадёт на @@unique([proposalId, userId]),
        // если пользователь уже голосовал.
        const voteRow = (await tx.vote.create({
          data: {
            proposalId: row.proposalId,
            stateId: row.stateId,
            userId: row.userId,
            choice: toPrismaChoice(row.choice),
            weight: row.weight,
            weightReason: row.weightReason,
            comment: row.comment,
          },
        })) as PrismaVoteRow;

        const incField =
          row.choice === "for"
            ? { totalWeightFor: { increment: row.weight } }
            : row.choice === "against"
              ? { totalWeightAgainst: { increment: row.weight } }
              : { totalWeightAbstain: { increment: row.weight } };

        const updated = (await tx.proposal.update({
          where: { id: row.proposalId },
          data: {
            ...incField,
            voteCount: { increment: 1 },
          },
        })) as PrismaProposalRow;

        return {
          vote: mapVote(voteRow),
          proposal: mapProposal(updated),
        };
      });
    },

    async findVote(proposalId, userId): Promise<Vote | null> {
      const row = (await loose.vote.findUnique({
        where: { proposalId_userId: { proposalId, userId } },
      })) as PrismaVoteRow | null;
      return row ? mapVote(row) : null;
    },

    async listVotes(proposalId) {
      const rows = (await loose.vote.findMany({
        where: { proposalId },
        orderBy: { createdAt: "asc" },
      })) as PrismaVoteRow[];
      return rows.map(mapVote);
    },

    async electorateSize(
      stateId,
      strategy: WeightStrategy,
      nodeWeights,
      balanceAssetId,
    ): Promise<number> {
      if (strategy === "one_person_one_vote") {
        // Всё activé membership в узлах этого State — один
        // человек один голос. Кворум = count(distinct user).
        const rows = (await loose.membership.findMany({
          where: { status: "active", node: { stateId } },
          select: { userId: true },
        })) as Array<{ userId: string }>;
        return new Set(rows.map((r) => r.userId)).size;
      }
      if (strategy === "by_node_weight") {
        const rows = (await loose.membership.findMany({
          where: { status: "active", node: { stateId } },
          select: { userId: true, nodeId: true },
        })) as Array<{ userId: string; nodeId: string }>;
        // per-user берём максимальный вес по его узлам (совпадает с
        // стратегией в сервисе).
        const perUser = new Map<string, number>();
        for (const row of rows) {
          const w = nodeWeights[row.nodeId] ?? 1;
          const prev = perUser.get(row.userId) ?? 0;
          if (w > prev) perUser.set(row.userId, w);
        }
        let total = 0;
        for (const v of perUser.values()) total += v;
        return total;
      }
      // by_balance: суммарный баланс personal-кошельков этого state.
      if (!balanceAssetId) return 0;
      const wallets = (await loose.wallet.findMany({
        where: {
          stateId,
          type: "PERSONAL",
          assetId: balanceAssetId,
        },
        select: { balance: true },
      })) as Array<{ balance: Decimal }>;
      let sum = ledgerDecimal(0);
      for (const w of wallets) sum = sum.plus(w.balance ?? 0);
      return sum.toNumber();
    },

    async balanceOf(stateId, userId, balanceAssetId): Promise<number> {
      const assetId =
        balanceAssetId ??
        (await (async () => {
          const row = (await loose.stateAsset.findMany({
            where: { stateId, isPrimary: true },
            select: { id: true },
            take: 1,
          })) as Array<{ id: string }>;
          return row[0]?.id ?? null;
        })());
      if (!assetId) return 0;
      const wallet = (await loose.wallet.findMany({
        where: { stateId, userId, assetId, type: "PERSONAL" },
        select: { balance: true },
        take: 1,
      })) as Array<{ balance: Decimal }>;
      return ledgerDecimal(wallet[0]?.balance ?? 0).toNumber();
    },

    async primaryAssetId(stateId): Promise<string | null> {
      const rows = (await loose.stateAsset.findMany({
        where: { stateId, isPrimary: true },
        select: { id: true },
        take: 1,
      })) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    },

    async userNodeIds(stateId, userId): Promise<string[]> {
      const rows = (await loose.membership.findMany({
        where: { userId, status: "active", node: { stateId } },
        select: { nodeId: true },
      })) as Array<{ nodeId: string }>;
      return rows.map((r) => r.nodeId);
    },

    async listDueProposals(now): Promise<Proposal[]> {
      const rows = (await loose.proposal.findMany({
        where: { status: "active", expiresAt: { lte: now } },
        orderBy: { expiresAt: "asc" },
        take: 200,
      })) as PrismaProposalRow[];
      return rows.map(mapProposal);
    },
  };
}

// ------------------------------------------------------------
// Row mappers
// ------------------------------------------------------------

function mapProposal(row: PrismaProposalRow): Proposal {
  if (!isGovernanceManageableKey(row.targetConfigKey)) {
    // DB-row с чужим ключом — вернём его как есть, но пометим в
    // метадате. Сервис при применении сразу получит
    // `GovernanceError("invalid_input")`; UI покажет «сломанное»
    // предложение.
    return {
      id: row.id,
      stateId: row.stateId,
      createdById: row.createdById,
      title: row.title,
      description: row.description,
      targetConfigKey: row.targetConfigKey as GovernanceManageableKey,
      newValue: row.newValue,
      status: row.status,
      quorumBps: row.quorumBps,
      thresholdBps: row.thresholdBps,
      weightStrategy: row.weightStrategy as WeightStrategy,
      modeAtCreation: row.modeAtCreation as Proposal["modeAtCreation"],
      sovereignVetoAtCreation: row.sovereignVetoAtCreation,
      totalWeightFor: row.totalWeightFor,
      totalWeightAgainst: row.totalWeightAgainst,
      totalWeightAbstain: row.totalWeightAbstain,
      voteCount: row.voteCount,
      executedById: row.executedById,
      vetoedById: row.vetoedById,
      vetoReason: row.vetoReason,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      executedAt: row.executedAt,
      metadata: normaliseMetadata(row.metadata),
    };
  }
  return {
    id: row.id,
    stateId: row.stateId,
    createdById: row.createdById,
    title: row.title,
    description: row.description,
    targetConfigKey: row.targetConfigKey,
    newValue: row.newValue,
    status: row.status,
    quorumBps: row.quorumBps,
    thresholdBps: row.thresholdBps,
    weightStrategy: row.weightStrategy as WeightStrategy,
    modeAtCreation: row.modeAtCreation as Proposal["modeAtCreation"],
    sovereignVetoAtCreation: row.sovereignVetoAtCreation,
    totalWeightFor: row.totalWeightFor,
    totalWeightAgainst: row.totalWeightAgainst,
    totalWeightAbstain: row.totalWeightAbstain,
    voteCount: row.voteCount,
    executedById: row.executedById,
    vetoedById: row.vetoedById,
    vetoReason: row.vetoReason,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    executedAt: row.executedAt,
    metadata: normaliseMetadata(row.metadata),
  };
}

function mapVote(row: PrismaVoteRow): Vote {
  return {
    id: row.id,
    proposalId: row.proposalId,
    stateId: row.stateId,
    userId: row.userId,
    choice:
      row.choice === "for_" ? "for" : row.choice === "against" ? "against" : "abstain",
    weight: row.weight,
    weightReason: row.weightReason,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

function toPrismaChoice(choice: VoteChoice): "for_" | "against" | "abstain" {
  // `for` — зарезервированное слово в Prisma; enum значение именовано `for_`.
  return choice === "for" ? "for_" : choice;
}

function normaliseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}
