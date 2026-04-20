/**
 * Pure aggregations for Pulse visualizations — derived only from
 * activity entries the viewer already received (visibility-filtered
 * by `/api/activity`). No invented metrics.
 */

export interface PulseActivitySlice {
  id: string;
  category: string;
  event: string;
  titleParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NamedSeriesPoint {
  key: string;
  value: number;
}

export interface VoteParticipationRow {
  entryId: string;
  proposalId: string;
  createdAt: string;
  voteCount: number;
  electorateSize: number;
  participation: number | null;
  quorumReached: boolean;
}

const WALLET_TX_EVENT = "core.wallet.transaction.created";
const PROPOSAL_CLOSED = "core.governance.proposal.closed";

function utcDayKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function mergeBuckets(
  buckets: Map<string, number>,
  maxDays: number,
): NamedSeriesPoint[] {
  const keys = [...buckets.keys()].sort();
  const slice = keys.slice(-maxDays);
  return slice.map((key) => ({ key, value: buckets.get(key) ?? 0 }));
}

/**
 * Sum of wallet event amounts (all kinds with a numeric `amount` in
 * `titleParams`) grouped by UTC day.
 */
export function aggregateWalletVolumeByDay(
  entries: PulseActivitySlice[],
  opts?: { maxDays?: number },
): NamedSeriesPoint[] {
  const maxDays = opts?.maxDays ?? 14;
  const buckets = new Map<string, number>();
  for (const e of entries) {
    if (e.category !== "wallet" || e.event !== WALLET_TX_EVENT) continue;
    const amount = e.titleParams.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    const day = utcDayKey(e.createdAt);
    if (!day) continue;
    buckets.set(day, (buckets.get(day) ?? 0) + amount);
  }
  return mergeBuckets(buckets, maxDays);
}

/**
 * State tax accruals on transfers — only rows where activity metadata
 * carries `stateTax.amount` (see wallet + activity-feed wiring).
 */
export function aggregateStateTaxByDay(
  entries: PulseActivitySlice[],
  opts?: { maxDays?: number },
): NamedSeriesPoint[] {
  const maxDays = opts?.maxDays ?? 14;
  const buckets = new Map<string, number>();
  for (const e of entries) {
    if (e.category !== "wallet" || e.event !== WALLET_TX_EVENT) continue;
    const st = e.metadata.stateTax;
    if (!st || typeof st !== "object" || st === null) continue;
    const amt = (st as { amount?: unknown }).amount;
    if (typeof amt !== "number" || !Number.isFinite(amt)) continue;
    const day = utcDayKey(e.createdAt);
    if (!day) continue;
    buckets.set(day, (buckets.get(day) ?? 0) + amt);
  }
  return mergeBuckets(buckets, maxDays);
}

/**
 * Participation rate for closed proposals — `voteCount / electorateSize`
 * when electorate is known and positive. One row per activity entry
 * (dedupe by proposalId keeping the latest `createdAt`).
 */
export function extractVoteParticipation(
  entries: PulseActivitySlice[],
  opts?: { limit?: number },
): VoteParticipationRow[] {
  const limit = opts?.limit ?? 12;
  const raw: VoteParticipationRow[] = [];
  for (const e of entries) {
    if (e.event !== PROPOSAL_CLOSED) continue;
    const pid = e.metadata.proposalId;
    if (typeof pid !== "string" || !pid) continue;
    const tally = e.metadata.tally;
    if (!tally || typeof tally !== "object" || tally === null) continue;
    const voteCount = (tally as { voteCount?: unknown }).voteCount;
    const electorateSize = (tally as { electorateSize?: unknown })
      .electorateSize;
    const quorumReached = (tally as { quorumReached?: unknown })
      .quorumReached;
    if (typeof voteCount !== "number" || typeof electorateSize !== "number")
      continue;
    const participation =
      electorateSize > 0 ? voteCount / electorateSize : null;
    raw.push({
      entryId: e.id,
      proposalId: pid,
      createdAt: e.createdAt,
      voteCount,
      electorateSize,
      participation,
      quorumReached: quorumReached === true,
    });
  }
  const byProposal = new Map<string, VoteParticipationRow>();
  for (const row of raw) {
    const prev = byProposal.get(row.proposalId);
    if (!prev || Date.parse(row.createdAt) >= Date.parse(prev.createdAt)) {
      byProposal.set(row.proposalId, row);
    }
  }
  const merged = [...byProposal.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return merged.slice(0, limit);
}

/** Internal helper for performance tests — runs all aggregations. */
export function runAllPulseAggregates(entries: PulseActivitySlice[]): void {
  aggregateWalletVolumeByDay(entries, { maxDays: 14 });
  aggregateStateTaxByDay(entries, { maxDays: 14 });
  extractVoteParticipation(entries, { limit: 12 });
}
