#!/usr/bin/env node
/**
 * krwn — Krwn CLI entrypoint.
 *
 * Dependency-free by design: uses only Node ≥ 20 built-ins
 * (fs, path, os, crypto, util.parseArgs, fetch). The CLI is a
 * thin HTTP client over /api/cli/* routes.
 */
import { run } from "../src/index.mjs";

run(process.argv.slice(2)).catch((err) => {
  const msg = err?.message ?? String(err);
  process.stderr.write(`\x1b[31merror:\x1b[0m ${msg}\n`);
  if (process.env.KRWN_DEBUG) {
    process.stderr.write((err?.stack ?? "") + "\n");
  }
  process.exit(1);
});
