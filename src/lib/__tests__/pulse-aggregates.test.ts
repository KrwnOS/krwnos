import { describe, expect, it } from "vitest";
import {
  aggregateStateTaxByDay,
  aggregateWalletVolumeByDay,
  extractVoteParticipation,
  runAllPulseAggregates,
  type PulseActivitySlice,
} from "../pulse-aggregates";

const base = (over: Partial<PulseActivitySlice>): PulseActivitySlice => ({
  id: "x",
  category: "wallet",
  event: "core.wallet.transaction.created",
  titleParams: {},
  metadata: {},
  createdAt: "2026-04-01T12:00:00.000Z",
  ...over,
});

describe("pulse-aggregates", () => {
  it("sums wallet volume by UTC day", () => {
    const entries: PulseActivitySlice[] = [
      base({
        id: "1",
        titleParams: { amount: 10, currency: "KRN", kind: "transfer" },
        createdAt: "2026-04-10T10:00:00.000Z",
      }),
      base({
        id: "2",
        titleParams: { amount: 5, currency: "KRN", kind: "transfer" },
        createdAt: "2026-04-10T15:00:00.000Z",
      }),
      base({
        id: "3",
        titleParams: { amount: 3, currency: "KRN", kind: "mint" },
        createdAt: "2026-04-11T08:00:00.000Z",
      }),
    ];
    const s = aggregateWalletVolumeByDay(entries, { maxDays: 7 });
    expect(s).toEqual([
      { key: "2026-04-10", value: 15 },
      { key: "2026-04-11", value: 3 },
    ]);
  });

  it("sums stateTax.amount when present", () => {
    const entries: PulseActivitySlice[] = [
      base({
        id: "1",
        metadata: { stateTax: { amount: 0.5, rate: 0.05 } },
        createdAt: "2026-04-10T10:00:00.000Z",
      }),
      base({
        id: "2",
        metadata: { stateTax: { amount: 1.2 } },
        createdAt: "2026-04-10T11:00:00.000Z",
      }),
    ];
    expect(aggregateStateTaxByDay(entries)).toEqual([
      { key: "2026-04-10", value: 1.7 },
    ]);
  });

  it("extracts vote participation from proposal.closed + tally", () => {
    const entries: PulseActivitySlice[] = [
      {
        id: "a",
        category: "governance",
        event: "core.governance.proposal.closed",
        titleParams: {},
        metadata: {
          proposalId: "p1",
          status: "passed",
          tally: {
            voteCount: 3,
            electorateSize: 10,
            totalCastWeight: 3,
            quorumReached: true,
          },
        },
        createdAt: "2026-04-12T12:00:00.000Z",
      },
      {
        id: "b",
        category: "governance",
        event: "core.governance.proposal.closed",
        titleParams: {},
        metadata: {
          proposalId: "p1",
          status: "passed",
          tally: {
            voteCount: 3,
            electorateSize: 10,
            totalCastWeight: 3,
            quorumReached: true,
          },
        },
        createdAt: "2026-04-11T12:00:00.000Z",
      },
    ];
    const rows = extractVoteParticipation(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.proposalId).toBe("p1");
    expect(rows[0]!.participation).toBeCloseTo(0.3);
  });

  it("handles large activity lists within a modest time budget", () => {
    const entries: PulseActivitySlice[] = Array.from(
      { length: 8000 },
      (_, i) =>
        base({
          id: `e-${i}`,
          titleParams: { amount: i % 100, currency: "KRN", kind: "transfer" },
          metadata:
            i % 5 === 0 ? { stateTax: { amount: (i % 10) / 100 } } : {},
          createdAt: new Date(Date.UTC(2026, 3, 1 + (i % 20), 12, 0, i)).toISOString(),
        }),
    );
    const t0 = performance.now();
    runAllPulseAggregates(entries);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(400);
  });
});
