/**
 * Treasury Watcher runner — отдельный процесс синхронизации.
 * ------------------------------------------------------------
 * Команды:
 *   tsx scripts/treasury-watcher.ts              # демоном
 *   tsx scripts/treasury-watcher.ts --once       # один проход и выход
 *   tsx scripts/treasury-watcher.ts --state <id> # только один State
 *   tsx scripts/treasury-watcher.ts --interval 15000
 *
 * Env:
 *   KRWN_WATCHER_INTERVAL_MS    дефолтный шаг опроса (30000)
 *   KRWN_WATCHER_DUST_THRESHOLD игнорировать diff'ы ниже (0)
 *   KRWN_RPC_<NETWORK>          RPC-URL для каждой сети (ethereum, polygon, …)
 *
 * Процесс ловит SIGTERM / SIGINT и завершает текущий тик штатно.
 */

import { prisma } from "@/lib/prisma";
import { createPrismaWatcherPersistence } from "@/modules/wallet/repo";
import { TreasuryWatcher } from "@/modules/wallet/watcher";
import { InMemoryEventBus } from "@/core/event-bus";
import { runTreasuryWatchTick } from "@/jobs/tasks";

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.once) {
    try {
      const report = await runTreasuryWatchTick({
        stateId: flags.stateId,
        intervalMs: flags.interval ?? numberEnv("KRWN_WATCHER_INTERVAL_MS", 30_000),
        dustThreshold: numberEnv("KRWN_WATCHER_DUST_THRESHOLD", 0),
      });
      const errs = report.errors.length
        ? ` errors=${report.errors.length}`
        : "";
      log(
        `tick checked=${report.checkedWallets} updated=${report.updatedWallets} reconciled=${report.reconciledTransactions}${errs}`,
      );
      for (const e of report.errors) {
        log(
          `  ! ${e.walletId ? `wallet=${e.walletId}` : ""}${
            e.transactionId ? `tx=${e.transactionId}` : ""
          }: ${e.message}`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const persistence = createPrismaWatcherPersistence(prisma);
  const bus = new InMemoryEventBus();

  const watcher = new TreasuryWatcher({
    persistence,
    bus,
    stateId: flags.stateId,
    intervalMs: flags.interval ?? numberEnv("KRWN_WATCHER_INTERVAL_MS", 30_000),
    dustThreshold: numberEnv("KRWN_WATCHER_DUST_THRESHOLD", 0),
    onTick(report) {
      const errs = report.errors.length
        ? ` errors=${report.errors.length}`
        : "";
      log(
        `tick checked=${report.checkedWallets} updated=${report.updatedWallets} reconciled=${report.reconciledTransactions}${errs}`,
      );
      for (const e of report.errors) {
        log(
          `  ! ${e.walletId ? `wallet=${e.walletId}` : ""}${
            e.transactionId ? `tx=${e.transactionId}` : ""
          }: ${e.message}`,
        );
      }
    },
  });

  log(
    `started — interval=${flags.interval ?? 30_000}ms${
      flags.stateId ? ` state=${flags.stateId}` : " (all states)"
    }`,
  );
  watcher.start();

  const shutdown = async (signal: string) => {
    log(`received ${signal}, stopping…`);
    await watcher.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------

interface Flags {
  once: boolean;
  stateId?: string;
  interval?: number;
}

function parseArgs(argv: string[]): Flags {
  const out: Flags = { once: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--state" && argv[i + 1]) out.stateId = argv[++i];
    else if (a === "--interval" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) out.interval = n;
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    }
  }
  return out;
}

function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[treasury-watcher] ${ts} ${msg}`);
}

const HELP = `
Treasury Watcher — on-chain balance synchroniser

USAGE
  tsx scripts/treasury-watcher.ts [options]
  npm run watcher:treasury -- [options]

OPTIONS
  --once               Run a single tick and exit (CI / cron).
  --state <id>         Only watch one State's treasuries.
  --interval <ms>      Poll interval in ms (default 30000).
  -h, --help           Show this help.

ENV
  KRWN_WATCHER_INTERVAL_MS     Default interval (fallback 30000)
  KRWN_WATCHER_DUST_THRESHOLD  Ignore diffs smaller than this (fallback 0)
  KRWN_RPC_ETHEREUM / KRWN_RPC_POLYGON / …  Per-network RPC URLs
`;

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[treasury-watcher] fatal:", err);
  process.exit(1);
});
