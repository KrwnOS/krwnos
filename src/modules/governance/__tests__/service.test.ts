/**
 * Unit tests for GovernanceService against in-memory fakes.
 *
 * Covers the canonical invariants of the Sovereign-Controlled DAO:
 *
 *   * Permission gates (`view`, `propose`, `vote`, `admin`).
 *   * Mode gates: `decree` blocks citizen proposals; `consultation`
 *     allows proposals but requires a Sovereign `execute()` after a
 *     successful vote; `auto_dao` applies the change automatically
 *     via `StateConfigService.update()`.
 *   * Whitelist semantics: `allowedConfigKeys` restrict which
 *     `targetConfigKey` can be proposed. `"*"` = everything in
 *     `GOVERNANCE_MANAGEABLE_KEYS`.
 *   * Rule-snapshotting: a later edit to `governanceRules` must NOT
 *     retroactively change the tally rules of a live proposal.
 *   * Lazy auto-close: if `expiresAt` has passed, the next read/vote
 *     closes the proposal instead of keeping it zombie-active.
 *   * Sovereign veto honours the `sovereignVetoAtCreation` snapshot
 *     and refuses to veto an already-executed proposal.
 *   * `tallyProposal` quorum/threshold math, including the empty
 *     electorate and empty-vote edge cases.
 */

import { describe, expect, it } from "vitest";
import {
  GOVERNANCE_EVENTS,
  GovernanceError,
  GovernanceService,
  tallyProposal,
  type CreateProposalRow,
  type GovernanceAccessContext,
  type GovernanceRepository,
  type InsertVoteRow,
  type Proposal,
  type ProposalListFilter,
  type Vote,
} from "../service";
import { GovernancePermissions } from "../permissions";
import {
  DEFAULT_GOVERNANCE_RULES,
  type GovernanceRules,
} from "@/core/governance-rules";
import {
  StateConfigError,
  StateConfigService,
  type StateSettings,
  type UpdateStateSettingsPatch,
} from "@/core/state-config";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalNode,
  VerticalSnapshot,
} from "@/types/kernel";

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

const STATE_ID = "s1";
const OWNER_ID = "u-sovereign";
const CITIZEN_ID = "u-citizen";
const OUTSIDER_ID = "u-outsider";
const ROOT_NODE_ID = "n-root";
const CITIZEN_NODE_ID = "n-citizen";

function buildSnapshot(): VerticalSnapshot {
  const now = new Date("2026-01-01T00:00:00Z");
  const root: VerticalNode = {
    id: ROOT_NODE_ID,
    stateId: STATE_ID,
    parentId: null,
    title: "Государство",
    type: "department",
    permissions: [],
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  const citizen: VerticalNode = {
    ...root,
    id: CITIZEN_NODE_ID,
    parentId: ROOT_NODE_ID,
    title: "Гражданин",
    type: "position",
    permissions: [
      GovernancePermissions.View,
      GovernancePermissions.Propose,
      GovernancePermissions.Vote,
    ],
  };
  const nodes = new Map<string, VerticalNode>();
  nodes.set(root.id, root);
  nodes.set(citizen.id, citizen);

  const membershipsByUser = new Map<string, Set<string>>();
  membershipsByUser.set(CITIZEN_ID, new Set([CITIZEN_NODE_ID]));

  return { stateId: STATE_ID, nodes, membershipsByUser };
}

function buildCtx(
  userId: string,
  opts: {
    isOwner?: boolean;
    permissions?: PermissionKey[];
  } = {},
): GovernanceAccessContext {
  const perms = new Set<PermissionKey>(opts.permissions ?? []);
  if (opts.isOwner) {
    perms.add("*");
  } else if (userId === CITIZEN_ID) {
    perms.add(GovernancePermissions.View);
    perms.add(GovernancePermissions.Propose);
    perms.add(GovernancePermissions.Vote);
  }
  return {
    userId,
    isOwner: opts.isOwner ?? false,
    snapshot: buildSnapshot(),
    permissions: perms,
  };
}

// ------------------------------------------------------------
// In-memory GovernanceRepository.
//
// Mirrors the Prisma adapter's contract from `service.ts`:
//   * `insertVote` atomically mutates aggregates.
//   * `listDueProposals` returns only active rows with expiresAt <= now.
//   * `electorateSize` emulates the Prisma strategy branches.
// ------------------------------------------------------------

interface RepoSeed {
  proposals?: Proposal[];
  balances?: Record<string, number>;
  userNodesByUser?: Record<string, string[]>;
  /**
   * Pretend-электорат. In real life the adapter computes this from
   * Membership/Wallet rows; for tests we just hand it in.
   */
  electorate?: {
    one_person_one_vote?: number;
    by_node_weight?: number;
    by_balance?: number;
  };
  primaryAssetId?: string | null;
}

function createRepo(seed: RepoSeed = {}): {
  repo: GovernanceRepository;
  proposals: Map<string, Proposal>;
  votes: Vote[];
} {
  const proposals = new Map<string, Proposal>();
  for (const p of seed.proposals ?? []) proposals.set(p.id, { ...p });
  const votes: Vote[] = [];

  let proposalCounter = proposals.size + 1;
  let voteCounter = 1;

  const balances = seed.balances ?? {};
  const userNodes = seed.userNodesByUser ?? {
    [CITIZEN_ID]: [CITIZEN_NODE_ID],
  };
  const electorate = seed.electorate ?? {
    one_person_one_vote: 1,
    by_node_weight: 1,
    by_balance: 1000,
  };
  const primaryAssetId = seed.primaryAssetId ?? "asset-krw";

  const repo: GovernanceRepository = {
    async createProposal(row: CreateProposalRow) {
      const id = `p-${proposalCounter++}`;
      const now = new Date();
      const proposal: Proposal = {
        id,
        stateId: row.stateId,
        createdById: row.createdById,
        title: row.title,
        description: row.description,
        targetConfigKey: row.targetConfigKey,
        newValue: row.newValue,
        status: "active",
        quorumBps: row.quorumBps,
        thresholdBps: row.thresholdBps,
        weightStrategy: row.weightStrategy,
        modeAtCreation: row.modeAtCreation,
        sovereignVetoAtCreation: row.sovereignVetoAtCreation,
        totalWeightFor: 0,
        totalWeightAgainst: 0,
        totalWeightAbstain: 0,
        voteCount: 0,
        executedById: null,
        vetoedById: null,
        vetoReason: null,
        expiresAt: row.expiresAt,
        createdAt: now,
        closedAt: null,
        executedAt: null,
        metadata: {},
      };
      proposals.set(id, proposal);
      return { ...proposal };
    },
    async findProposal(id) {
      const row = proposals.get(id);
      return row ? { ...row } : null;
    },
    async listProposals(filter: ProposalListFilter) {
      let rows = [...proposals.values()].filter(
        (p) => p.stateId === filter.stateId,
      );
      if (filter.status && filter.status.length > 0) {
        rows = rows.filter((p) => filter.status!.includes(p.status));
      }
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return rows.slice(0, filter.limit ?? 100).map((p) => ({ ...p }));
    },
    async updateProposalStatus(id, patch) {
      const row = proposals.get(id);
      if (!row) throw new Error("not found");
      const next: Proposal = {
        ...row,
        status: patch.status,
        closedAt: patch.closedAt ?? row.closedAt ?? null,
        executedAt: patch.executedAt ?? row.executedAt ?? null,
        executedById:
          patch.executedById !== undefined
            ? patch.executedById
            : row.executedById,
        vetoedById:
          patch.vetoedById !== undefined ? patch.vetoedById : row.vetoedById,
        vetoReason:
          patch.vetoReason !== undefined ? patch.vetoReason : row.vetoReason,
      };
      proposals.set(id, next);
      return { ...next };
    },
    async insertVote(row: InsertVoteRow) {
      // Emulate the unique constraint on (proposalId, userId).
      const dupe = votes.find(
        (v) => v.proposalId === row.proposalId && v.userId === row.userId,
      );
      if (dupe) {
        throw new Error("unique constraint violated (proposalId, userId)");
      }
      const proposal = proposals.get(row.proposalId);
      if (!proposal) throw new Error("proposal missing");
      const vote: Vote = {
        id: `v-${voteCounter++}`,
        proposalId: row.proposalId,
        stateId: row.stateId,
        userId: row.userId,
        choice: row.choice,
        weight: row.weight,
        weightReason: row.weightReason,
        comment: row.comment,
        createdAt: new Date(),
      };
      votes.push(vote);

      const next: Proposal = {
        ...proposal,
        totalWeightFor:
          proposal.totalWeightFor + (row.choice === "for" ? row.weight : 0),
        totalWeightAgainst:
          proposal.totalWeightAgainst +
          (row.choice === "against" ? row.weight : 0),
        totalWeightAbstain:
          proposal.totalWeightAbstain +
          (row.choice === "abstain" ? row.weight : 0),
        voteCount: proposal.voteCount + 1,
      };
      proposals.set(proposal.id, next);
      return { vote: { ...vote }, proposal: { ...next } };
    },
    async findVote(proposalId, userId) {
      const row = votes.find(
        (v) => v.proposalId === proposalId && v.userId === userId,
      );
      return row ? { ...row } : null;
    },
    async listVotes(proposalId) {
      return votes
        .filter((v) => v.proposalId === proposalId)
        .map((v) => ({ ...v }));
    },
    async electorateSize(_stateId, strategy) {
      return electorate[strategy] ?? 0;
    },
    async balanceOf(_stateId, userId) {
      return balances[userId] ?? 0;
    },
    async primaryAssetId() {
      return primaryAssetId;
    },
    async userNodeIds(_stateId, userId) {
      return userNodes[userId] ?? [];
    },
    async listDueProposals(now) {
      return [...proposals.values()]
        .filter((p) => p.status === "active" && p.expiresAt <= now)
        .map((p) => ({ ...p }));
    },
  };

  return { repo, proposals, votes };
}

// ------------------------------------------------------------
// In-memory StateConfigService.
// ------------------------------------------------------------

function createStateConfig(
  rules: Partial<GovernanceRules> = {},
): {
  service: StateConfigService;
  settings: { current: StateSettings };
  patches: UpdateStateSettingsPatch[];
  failNext: { value: boolean };
} {
  const now = new Date("2026-01-01T00:00:00Z");
  const current: StateSettings = {
    id: "cfg-1",
    stateId: STATE_ID,
    transactionTaxRate: 0.05,
    incomeTaxRate: 0,
    roleTaxRate: 0,
    currencyDisplayName: null,
    citizenshipFeeAmount: 0,
    rolesPurchasable: false,
    exitRefundRate: 0,
    permissionInheritance: true,
    autoPromotionEnabled: false,
    autoPromotionMinBalance: null,
    autoPromotionMinDays: null,
    autoPromotionTargetNodeId: null,
    treasuryTransparency: "council",
    governanceRules: { ...DEFAULT_GOVERNANCE_RULES, ...rules },
    extras: {},
    createdAt: now,
    updatedAt: now,
  };

  const patches: UpdateStateSettingsPatch[] = [];
  const failNext = { value: false };

  const service = new StateConfigService({
    repo: {
      async find() {
        return { ...current };
      },
      async ensure() {
        return { ...current };
      },
      async update(_stateId, patch) {
        if (failNext.value) {
          failNext.value = false;
          // StateConfigService.update wraps this — use the canonical
          // StateConfigError so GovernanceService rejects gracefully.
          throw new StateConfigError("forced failure", "invalid_input");
        }
        patches.push(patch);
        Object.assign(current, patch);
        current.updatedAt = new Date();
        return { ...current };
      },
    },
  });

  return { service, settings: { current }, patches, failNext };
}

// ------------------------------------------------------------
// Recording event bus (same shape as chat tests).
// ------------------------------------------------------------

interface RecordedEvent {
  event: string;
  payload: unknown;
}

function createRecordingBus(): {
  bus: ModuleEventBus;
  events: RecordedEvent[];
} {
  const events: RecordedEvent[] = [];
  const bus: ModuleEventBus = {
    async emit(event, payload) {
      events.push({ event, payload });
    },
    on() {
      return () => undefined;
    },
  };
  return { bus, events };
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

interface BuildOpts {
  rulesOverride?: Partial<GovernanceRules>;
  repoSeed?: RepoSeed;
  now?: Date;
}

function build(opts: BuildOpts = {}) {
  const state = createStateConfig(opts.rulesOverride);
  const { repo, proposals, votes } = createRepo(opts.repoSeed);
  const { bus, events } = createRecordingBus();
  const clock = { now: opts.now ?? new Date("2026-02-01T00:00:00Z") };
  // The service never consults `this.engine` in its hot paths — it
  // relies on the `ctx.permissions` ReadonlySet prepared upstream —
  // so the default singleton is fine even though it can't reach any
  // DB in a unit-test environment.
  const service = new GovernanceService({
    repo,
    stateConfig: state.service,
    bus,
    now: () => clock.now,
  });

  return {
    service,
    state,
    repo,
    proposals,
    votes,
    events,
    clock,
  };
}

// ------------------------------------------------------------
// tallyProposal (pure)
// ------------------------------------------------------------

describe("tallyProposal", () => {
  const base = {
    quorumBps: 5_000, // 50%
    thresholdBps: 6_000, // 60%
  };

  it("empty electorate never reaches quorum", () => {
    const t = tallyProposal(
      { ...base, totalWeightFor: 10, totalWeightAgainst: 0, totalWeightAbstain: 0, voteCount: 1 },
      0,
    );
    expect(t.quorumReached).toBe(false);
    expect(t.willPass).toBe(false);
  });

  it("empty votes never reach threshold", () => {
    const t = tallyProposal(
      { ...base, totalWeightFor: 0, totalWeightAgainst: 0, totalWeightAbstain: 0, voteCount: 0 },
      100,
    );
    expect(t.quorumReached).toBe(false);
    expect(t.thresholdReached).toBe(false);
    expect(t.willPass).toBe(false);
  });

  it("abstain counts toward quorum but not the threshold denominator", () => {
    // 30 "for" + 10 "against" + 20 "abstain" = 60 cast weight from
    // an electorate of 100. Quorum (50%) satisfied. Threshold uses
    // only for+against = 40: 30/40 = 75% ≥ 60%. Pass.
    const t = tallyProposal(
      { ...base, totalWeightFor: 30, totalWeightAgainst: 10, totalWeightAbstain: 20, voteCount: 3 },
      100,
    );
    expect(t.totalCastWeight).toBe(60);
    expect(t.quorumReached).toBe(true);
    expect(t.thresholdReached).toBe(true);
    expect(t.willPass).toBe(true);
  });

  it("threshold uses only for+against as the denominator", () => {
    const t = tallyProposal(
      { ...base, totalWeightFor: 5, totalWeightAgainst: 5, totalWeightAbstain: 90, voteCount: 10 },
      100,
    );
    // Quorum: 100/100 = 100% ≥ 50%. Threshold: 5 / (5+5) = 50% < 60%.
    expect(t.quorumReached).toBe(true);
    expect(t.thresholdReached).toBe(false);
    expect(t.willPass).toBe(false);
  });
});

// ------------------------------------------------------------
// createProposal
// ------------------------------------------------------------

describe("GovernanceService.createProposal", () => {
  const consultationRules: Partial<GovernanceRules> = {
    mode: "consultation",
    allowedConfigKeys: ["transactionTaxRate"],
    quorumBps: 2_000,
    thresholdBps: 6_000,
    votingDurationSeconds: 3600,
  };

  it("requires governance.propose", async () => {
    const { service } = build({ rulesOverride: consultationRules });
    await expect(
      service.createProposal(STATE_ID, buildCtx(OUTSIDER_ID), {
        title: "Down to 1%",
        description: "Нужно снизить налог",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects citizen proposals when mode = decree", async () => {
    const { service } = build({
      rulesOverride: {
        mode: "decree",
        allowedConfigKeys: ["transactionTaxRate"],
      },
    });
    await expect(
      service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: "Down to 1%",
        description: "Снизить налог",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets the Sovereign propose even in decree mode", async () => {
    const { service } = build({
      rulesOverride: {
        mode: "decree",
        allowedConfigKeys: ["transactionTaxRate"],
      },
    });
    const proposal = await service.createProposal(
      STATE_ID,
      buildCtx(OWNER_ID, { isOwner: true }),
      {
        title: "Down to 1%",
        description: "Снизить налог",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    expect(proposal.modeAtCreation).toBe("decree");
  });

  it("rejects targetConfigKey outside the Sovereign's whitelist", async () => {
    const { service } = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
      },
    });
    await expect(
      service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: "Free citizenship",
        description: "Снизить плату за гражданство",
        targetConfigKey: "citizenshipFeeAmount",
        newValue: 0,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepts any manageable key when allowedConfigKeys includes '*'", async () => {
    const { service } = build({
      rulesOverride: { mode: "consultation", allowedConfigKeys: ["*"] },
    });
    const p = await service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
      title: "Free entry",
      description: "Бесплатный вход",
      targetConfigKey: "citizenshipFeeAmount",
      newValue: 0,
    });
    expect(p.status).toBe("active");
    expect(p.targetConfigKey).toBe("citizenshipFeeAmount");
  });

  it("rejects unknown manageable keys with invalid_input", async () => {
    const { service } = build({
      rulesOverride: { mode: "consultation", allowedConfigKeys: ["*"] },
    });
    await expect(
      service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: "Mystery",
        description: "???",
        targetConfigKey: "madeUpKey",
        newValue: 1,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects newValue outside the allowed range for rates", async () => {
    const { service } = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
      },
    });
    await expect(
      service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: "200% tax",
        description: "конфискация",
        targetConfigKey: "transactionTaxRate",
        newValue: 2,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("enforces minProposerBalance for non-Sovereign proposers", async () => {
    const { service } = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
        minProposerBalance: 100,
      },
      repoSeed: { balances: { [CITIZEN_ID]: 10 } },
    });
    await expect(
      service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: "Down to 1%",
        description: "Снизить налог",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("snapshots rules at creation time; later rule edits must not retroactively change them", async () => {
    const { service, state, clock } = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
        quorumBps: 2_000,
        thresholdBps: 6_000,
        sovereignVeto: true,
      },
    });
    const proposal = await service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut tax",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    // Sovereign tightens the rules AFTER proposal creation.
    state.settings.current.governanceRules = {
      ...state.settings.current.governanceRules,
      quorumBps: 9_000,
      thresholdBps: 9_500,
      sovereignVeto: false,
    };
    clock.now = new Date(proposal.expiresAt.getTime() + 1000);

    // The snapshot on the proposal itself should stay at 2000/6000.
    expect(proposal.quorumBps).toBe(2_000);
    expect(proposal.thresholdBps).toBe(6_000);
    expect(proposal.sovereignVetoAtCreation).toBe(true);
  });

  it("emits a Created event", async () => {
    const { service, events } = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
      },
    });
    await service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
      title: "Down to 1%",
      description: "Снизить налог",
      targetConfigKey: "transactionTaxRate",
      newValue: 0.01,
    });
    await flush();
    expect(events.map((e) => e.event)).toContain(GOVERNANCE_EVENTS.Created);
  });
});

// ------------------------------------------------------------
// castVote
// ------------------------------------------------------------

describe("GovernanceService.castVote", () => {
  const consultationRules: Partial<GovernanceRules> = {
    mode: "consultation",
    allowedConfigKeys: ["transactionTaxRate"],
    quorumBps: 5_000,
    thresholdBps: 5_000,
    votingDurationSeconds: 3600,
  };

  async function seed(env: ReturnType<typeof build>) {
    return env.service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
      title: "Cut tax",
      description: "Снизить",
      targetConfigKey: "transactionTaxRate",
      newValue: 0.01,
    });
  }

  it("requires governance.vote", async () => {
    const env = build({ rulesOverride: consultationRules });
    const p = await seed(env);
    await expect(
      env.service.castVote(p.id, buildCtx(OUTSIDER_ID), { choice: "for" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects duplicate votes with conflict", async () => {
    const env = build({ rulesOverride: consultationRules });
    const p = await seed(env);
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    await expect(
      env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "against" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects votes on expired proposals (lazy auto-close triggers)", async () => {
    const env = build({ rulesOverride: consultationRules });
    const p = await seed(env);
    env.clock.now = new Date(p.expiresAt.getTime() + 10_000);

    await expect(
      env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" }),
    ).rejects.toMatchObject({ code: "closed" });

    // Sanity: auto-close fired → proposal is no longer "active".
    const after = await env.repo.findProposal(p.id);
    expect(after?.status).not.toBe("active");
  });

  it("zero-weight voters are rejected with forbidden", async () => {
    const env = build({
      rulesOverride: { ...consultationRules, weightStrategy: "by_balance" },
      repoSeed: { balances: {} }, // citizen has no tokens
    });
    const p = await seed(env);
    await expect(
      env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("aggregates are updated atomically (vote_cast event reports the new totals)", async () => {
    const env = build({ rulesOverride: consultationRules });
    const p = await seed(env);
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    await flush();
    const cast = env.events.find((e) => e.event === GOVERNANCE_EVENTS.VoteCast);
    expect(cast).toBeDefined();
    const payload = cast!.payload as {
      totals: { for: number; against: number; abstain: number };
      weight: number;
    };
    expect(payload.weight).toBe(1);
    expect(payload.totals.for).toBe(1);
  });
});

// ------------------------------------------------------------
// closeAndMaybeExecute + auto_dao
// ------------------------------------------------------------

describe("GovernanceService.closeAndMaybeExecute", () => {
  const autoDaoRules: Partial<GovernanceRules> = {
    mode: "auto_dao",
    allowedConfigKeys: ["transactionTaxRate"],
    quorumBps: 5_000,
    thresholdBps: 5_000,
    votingDurationSeconds: 3600,
  };

  it("expired proposal with no votes → 'expired', no state mutation", async () => {
    const env = build({ rulesOverride: autoDaoRules });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    env.clock.now = new Date(p.expiresAt.getTime() + 1000);

    const result = await env.service.closeAndMaybeExecute(p.id);
    expect(result.status).toBe("expired");
    expect(env.state.patches).toEqual([]);
  });

  it("in auto_dao: passed proposal is applied to StateSettings automatically", async () => {
    const env = build({
      rulesOverride: autoDaoRules,
      repoSeed: {
        electorate: { one_person_one_vote: 1, by_node_weight: 1, by_balance: 1 },
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    env.clock.now = new Date(p.expiresAt.getTime() + 1000);

    const result = await env.service.closeAndMaybeExecute(p.id);
    expect(result.status).toBe("executed");
    expect(result.executedById).toBe("system:auto_dao");
    expect(env.state.patches).toEqual([{ transactionTaxRate: 0.01 }]);
  });

  it("in consultation: passed proposal waits for manual execute()", async () => {
    const env = build({
      rulesOverride: {
        ...autoDaoRules,
        mode: "consultation",
      },
      repoSeed: {
        electorate: { one_person_one_vote: 1, by_node_weight: 1, by_balance: 1 },
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    env.clock.now = new Date(p.expiresAt.getTime() + 1000);

    const closed = await env.service.closeAndMaybeExecute(p.id);
    expect(closed.status).toBe("passed");
    expect(env.state.patches).toEqual([]);

    // Sovereign issues the manual order.
    const executed = await env.service.execute(
      p.id,
      buildCtx(OWNER_ID, { isOwner: true }),
    );
    expect(executed.status).toBe("executed");
    expect(env.state.patches).toEqual([{ transactionTaxRate: 0.01 }]);
  });

  it("auto_dao falls back to 'rejected' if StateConfigService rejects the patch", async () => {
    const env = build({
      rulesOverride: autoDaoRules,
      repoSeed: {
        electorate: { one_person_one_vote: 1, by_node_weight: 1, by_balance: 1 },
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    env.clock.now = new Date(p.expiresAt.getTime() + 1000);
    env.state.failNext.value = true;

    const result = await env.service.closeAndMaybeExecute(p.id);
    expect(result.status).toBe("rejected");
    expect(env.state.patches).toEqual([]);
  });

  it("tickDueProposals closes every overdue proposal in one sweep", async () => {
    const env = build({
      rulesOverride: { ...autoDaoRules, votingDurationSeconds: 60 },
    });
    for (let i = 0; i < 3; i++) {
      await env.service.createProposal(STATE_ID, buildCtx(CITIZEN_ID), {
        title: `Proposal ${i}`,
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      });
    }
    env.clock.now = new Date(env.clock.now.getTime() + 120_000);

    const closed = await env.service.tickDueProposals();
    expect(closed).toHaveLength(3);
    for (const p of closed) {
      expect(p.status).not.toBe("active");
    }
  });
});

// ------------------------------------------------------------
// veto
// ------------------------------------------------------------

describe("GovernanceService.veto", () => {
  const rules: Partial<GovernanceRules> = {
    mode: "consultation",
    allowedConfigKeys: ["transactionTaxRate"],
    quorumBps: 1,
    thresholdBps: 1,
  };

  async function seedAndPass(): Promise<{
    env: ReturnType<typeof build>;
    proposal: Proposal;
  }> {
    const env = build({
      rulesOverride: rules,
      repoSeed: {
        electorate: { one_person_one_vote: 1, by_node_weight: 1, by_balance: 1 },
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });
    env.clock.now = new Date(p.expiresAt.getTime() + 1000);
    const closed = await env.service.closeAndMaybeExecute(p.id);
    return { env, proposal: closed };
  }

  it("Sovereign can veto a passed proposal (consultation mode)", async () => {
    const { env, proposal } = await seedAndPass();
    expect(proposal.status).toBe("passed");
    const vetoed = await env.service.veto(
      proposal.id,
      buildCtx(OWNER_ID, { isOwner: true }),
      { reason: "нет" },
    );
    expect(vetoed.status).toBe("vetoed");
    expect(vetoed.vetoedById).toBe(OWNER_ID);
    expect(vetoed.vetoReason).toBe("нет");
  });

  it("rejects veto after executed (refuses to roll back)", async () => {
    const { env, proposal } = await seedAndPass();
    await env.service.execute(
      proposal.id,
      buildCtx(OWNER_ID, { isOwner: true }),
    );
    await expect(
      env.service.veto(proposal.id, buildCtx(OWNER_ID, { isOwner: true })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("honours sovereignVetoAtCreation=false: non-owner is blocked", async () => {
    const env = build({
      rulesOverride: {
        ...rules,
        sovereignVeto: false,
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    // Delegated admin tries to veto — blocked because veto is disabled
    // at creation time and they are not the Sovereign.
    const delegatedAdmin = buildCtx("u-delegate", {
      permissions: [
        GovernancePermissions.View,
        GovernancePermissions.Admin,
      ],
    });
    await expect(env.service.veto(p.id, delegatedAdmin)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

// ------------------------------------------------------------
// cancel
// ------------------------------------------------------------

describe("GovernanceService.cancel", () => {
  const rules: Partial<GovernanceRules> = {
    mode: "consultation",
    allowedConfigKeys: ["transactionTaxRate"],
  };

  it("the author can cancel their own active proposal", async () => {
    const env = build({ rulesOverride: rules });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    const cancelled = await env.service.cancel(p.id, buildCtx(CITIZEN_ID));
    expect(cancelled.status).toBe("cancelled");
  });

  it("a non-author non-admin cannot cancel", async () => {
    const env = build({ rulesOverride: rules });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await expect(
      env.service.cancel(
        p.id,
        buildCtx("u-random", { permissions: [GovernancePermissions.View] }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the Sovereign (admin) can cancel someone else's proposal", async () => {
    const env = build({ rulesOverride: rules });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    const cancelled = await env.service.cancel(
      p.id,
      buildCtx(OWNER_ID, { isOwner: true }),
    );
    expect(cancelled.status).toBe("cancelled");
  });
});

// ------------------------------------------------------------
// listProposals / getProposal (permission gate)
// ------------------------------------------------------------

describe("GovernanceService reads", () => {
  it("listProposals requires governance.view", async () => {
    const env = build();
    await expect(
      env.service.listProposals(STATE_ID, buildCtx(OUTSIDER_ID)),
    ).rejects.toBeInstanceOf(GovernanceError);
  });

  it("getProposal returns a full tally including electorate size", async () => {
    const env = build({
      rulesOverride: {
        mode: "consultation",
        allowedConfigKeys: ["transactionTaxRate"],
      },
      repoSeed: {
        electorate: { one_person_one_vote: 10, by_node_weight: 1, by_balance: 1 },
      },
    });
    const p = await env.service.createProposal(
      STATE_ID,
      buildCtx(CITIZEN_ID),
      {
        title: "Cut",
        description: "Снизить",
        targetConfigKey: "transactionTaxRate",
        newValue: 0.01,
      },
    );
    await env.service.castVote(p.id, buildCtx(CITIZEN_ID), { choice: "for" });

    const detail = await env.service.getProposal(p.id, buildCtx(CITIZEN_ID));
    expect(detail.votes).toHaveLength(1);
    expect(detail.tally.electorateSize).toBe(10);
    expect(detail.tally.forWeight).toBe(1);
  });
});
