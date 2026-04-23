# KrwnOS — Project Context (load this first)

You're working on **KrwnOS**, a modular operating system for building digital
states, companies, and communities. One State = one instance, owned by a
Sovereign. The platform is at v0.1 (Phase 4.5 closed), currently in Horizon 3
(module ecosystem).

## Stack

- Next.js 14 (App Router), TypeScript strict (+ `noUncheckedIndexedAccess`)
- PostgreSQL 15 + Prisma 5 (34 models, 17 migrations)
- Redis (ioredis), BullMQ for background jobs
- Tailwind CSS + shadcn-style primitives
- vitest for unit tests, Playwright for e2e
- Pino logger, OpenTelemetry tracing

## Architecture (non-negotiable rules)

- **`src/core/*` never imports from `src/modules/*`.** The kernel knows nothing
  about specific modules.
- **No hard-coded role checks.** Never `if (user.role === 'admin')`. Always
  `permissionsEngine.can(stateId, userId, key, nodeId?)`.
- **New functionality = new module.** Not ad-hoc code in `src/app/`.
- **Modules are sandboxed.** They access the DB through `ModuleContext.db`
  (scoped to `krwn_<slug>_<stateIdPrefix>` schema), not the global Prisma
  client. Secrets go through `ctx.secrets.get()`, never raw env reads inside
  module code.
- **`docs/ROADMAP.md` is a living contract.** Any PR that changes scope
  updates it in the same PR. See §0 of that file.

## Key paths

- `src/core/` — kernel: auth, permissions-engine, registry, event-bus,
  sandboxing, governance-rules, wallet primitives.
- `src/modules/` — first-party modules: `chat`, `governance`, `wallet`,
  `tasks`. Registered in `src/modules/index.ts`.
- `src/app/` — Next.js App Router routes and pages. API routes under
  `src/app/api/`.
- `src/lib/` — shared utilities (prisma client, redis, rate-limit, i18n,
  otel, same-origin guard, web-push).
- `packages/sdk/` — `@krwnos/sdk`: `KrwnModule`, `ModuleContext`, manifest
  validator, harness.
- `prisma/schema.prisma` — the schema. Migrations in `prisma/migrations/`.
- `docs/` — all project documentation. `ROADMAP.md`, `WHITEPAPER.md`,
  `ARCHITECTURE.md`, `MODULE_GUIDE.md`, `DATABASE.md`, `DEPLOYMENT.md`,
  `SETUP.md`, `CLI.md`.
- `cli/` — `@krwnos/cli`: `krwn login/module/vertical/invite/backup/token/status`.

## Discipline

- **Test coverage gate:** `src/core/**` must stay at or above 70% lines,
  functions, and branches. Enforced in CI. The project is currently ~89%.
- **Merge train:** only one PR at a time to `main`. Don't open a second PR
  until the first is merged. This avoids conflicts in `package-lock.json`,
  `schema.prisma`, `next.config.mjs`.
- **ROADMAP updates in the same PR.** If you close a roadmap item, move it
  from its horizon to §9 Done with date and commit ref. If you add a new
  item, put it in the right horizon or the parking lot.
- **CHANGELOG.md** gets a user-facing entry for each notable change. (Note:
  S1.4 reconciles the exact split between CHANGELOG.md and ROADMAP §9 — until
  that's done, err toward ROADMAP §9 for scope/delivery entries and
  CHANGELOG.md for user-visible items.)

## Test commands

- `npm run typecheck` — strict TypeScript across SDK and main.
- `npm run lint` — Next.js ESLint config.
- `npm test` — vitest unit tests.
- `KRWN_INTEGRATION=1 npm test` — includes integration tests that need
  `TEST_DATABASE_URL` pointing to a real Postgres.
- `npm run build && npm run test:e2e` — Playwright against a production
  build.

## When you're done

1. All tests pass locally.
2. CI is green on the PR.
3. `docs/ROADMAP.md` is updated in the same PR per §0.
4. `CHANGELOG.md` gets an `[Unreleased]` entry if the change is user-visible.
5. Branch name: `cursor/<short-task-slug>` or `agent/<short-task-slug>`.
6. PR title format: `feat(scope): short description` or `test(scope): …`
   etc., matching the existing git log style.
7. Stop. Do not pick up the next task — that's for the next fresh agent.
