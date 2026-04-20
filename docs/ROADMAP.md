# KrwnOS — Roadmap

> Живой документ. Единственный источник правды по плану развития.
> `WHITEPAPER.md` описывает, ЧТО система умеет сейчас.
> `ROADMAP.md` описывает, ЧТО будет и в каком порядке.

**Обновлено:** 2026-04-20 — Responsive pass (чат + Pulse / dashboard)
**Актуальный горизонт:** Horizon 0 — Стабилизация фундамента
**Версия платформы:** v0.1 (Phase 4.5 закрыта)

---

## 0. Контракт обновления (обязателен!)

Этот файл — не «заметка в углу», а живой контракт проекта. Правила:

1. **Любое** изменение в коде, которое меняет scope (закрывает пункт,
   вводит новый, меняет приоритет) — обязано в том же PR обновить
   `docs/ROADMAP.md`.
2. Закрытый пункт переезжает из `Horizon N` в секцию `Done` с датой и
   ссылкой на коммит/PR. Не удаляется — это одновременно changelog.
3. Новый пункт добавляется в правильный горизонт. Если горизонт
   неочевиден — в `Parking lot` внизу документа.
4. При старте работы над пунктом — меняем `[ ]` → `[~]` (in progress)
   и вписываем исполнителя: `[~] @handle — Decimal migration`.
5. При завершении — `[x]` + дата + ссылка: `[x] 2026-04-22 (#123)`.
6. Дата «Обновлено» в шапке файла обновляется вместе с любой правкой.
7. Если пункт уехал с горизонта на квартал вперёд — переносим явно,
   не оставляем молча.
8. **Merge train (несколько агентов):** если несколько агентов
   закрывают пункты одного спринта — **следующий агент открывает PR
   только после merge PR предыдущего** в основную ветку. Иначе
   неизбежны конфликты в `package-lock.json`, `schema.prisma`,
   `next.config.mjs`. Текущий порядок — см. §7 «Sprint 1».

> ⚠️ Cursor-агенты обязаны следовать `.cursor/rules/roadmap.mdc`
> и самостоятельно обновлять этот файл при любых изменениях scope.

---

## 1. Статус по фазам

| Фаза | Что | Статус |
|------|-----|--------|
| Phase 1 | Foundation: ядро, типы, Permissions Engine, Registry, Event Bus, Prisma schema, Auth adapter | ✅ |
| Phase 2 | Vertical Management: CRUD узлов, Membership, Lobby | ✅ |
| Phase 3 | Module System: bootstrap, `core.chat`, Widget Shell | ✅ |
| Phase 4 | Sovereign Node: три tier-а, CLI, magic-link invitations, Credentials Registry, Tunneling, Backup, schema-per-module | ✅ |
| Phase 4.5 | Economy + Governance v0.1: Currency Factory, кошельки, казначейства, Krwn Exchange, Палата Указов, core.governance, Pulse, Theme Engine | ✅ |
| Phase 5 | Scaling — см. Horizon 1–4 ниже | ⏳ |

---

## 2. Horizon 0 — Стабилизация фундамента (active)

Цель: довести v0.1 до состояния, в котором не стыдно звать первого
реального Суверена. Критерий выхода из горизонта: зелёный CI, тесты
`core/*` ≥ 70 %, Decimal для денег, security-middleware включён.

### Тесты и CI

- [x] 2026-04-19 GitHub Actions `.github/workflows/ci.yml`: `npm ci` →
      `prisma validate` → `prisma migrate deploy` (Postgres 15 service) →
      `lint` → `typecheck` → `vitest run --coverage` (пороги ≥70 % на
      `src/core/**`) → `next build` → Playwright (`npm run test:e2e`, Redis
      service, `npx playwright install --with-deps chromium`).
- [x] `core/permissions-engine` — покрытие через
      `src/core/__tests__/permissions-engine.test.ts`.
- [x] `core/invitations` — покрытие через
      `src/core/__tests__/invitations.test.ts`.
- [x] 2026-04-19 `core/setup-state` — идемпотентность, транзакционный bootstrap,
      unit + optional Postgres integration: `src/core/__tests__/setup-state.test.ts`,
      `src/core/__tests__/setup-state.integration.test.ts` (`TEST_DATABASE_URL`).
- [x] 2026-04-19 `core/backup` — round-trip: `BackupService` +
      `restoreBackupPayload` + `src/core/backup-prisma.ts`; проверки в
      `src/core/__tests__/setup-state.integration.test.ts` при
      `TEST_DATABASE_URL` (см. §9).
- [x] `modules/governance` — покрытие через
      `src/modules/governance/__tests__/service.test.ts`.
- [x] 2026-04-19 `modules/wallet` — налог в Казну, гонки, ON_CHAIN intent (mock):
      `wallet.service.test.ts`, `wallet.integration.test.ts` (+ CI при
      `TEST_DATABASE_URL`).
- [x] 2026-04-19 E2E Playwright: `e2e/smoke.spec.ts` (+ шаг в CI после `next build`).

### Денежный контур

- [x] 2026-04-19 Миграция `Float` → `Decimal` для `Wallet.balance` и
      `Transaction.amount` (`prisma/migrations/20260422100000_wallet_ledger_decimal`).
- [x] 2026-04-19 Hot-path: `WalletService.transfer`, `repo.executeTransfer`,
      Krwn Exchange adapter, citizenship fee, pulse/nexus aggregates,
      Treasury Watcher dust — на `Prisma.Decimal` / `ledgerDecimal`.
- [x] 2026-04-19 Расширенные тесты округления / конкурентных transfer — см.
      `wallet.integration.test.ts` и §9.

### Security и observability

- [x] 2026-04-19 Audit CSRF + same-origin guard на публичных `POST` —
      `docs/ARCHITECTURE.md` §7, `src/lib/same-origin-mutation.ts`, тесты
      `src/lib/__tests__/same-origin-mutation.test.ts`.
- [x] 2026-04-19 AEAD модульных секретов — `src/core/module-secret-vault.ts`,
      тесты `src/core/__tests__/module-secret-vault.test.ts`.
- [x] 2026-04-19 OpenTelemetry — `src/instrumentation.ts`,
      `src/lib/otel/start-node-sdk.ts`, env в `docs/DEPLOYMENT.md`.

### Гигиена репо

- [x] 2026-04-19 — `.next/`: не в индексе/истории; игнор в `.gitignore`
      (`.next/`). Одноразовая чистка истории при необходимости — §9. (#—)
- [x] 2026-04-19 — `compose-build.log` в `.gitignore`, снят с трекинга
      (`git rm --cached`). (#—)
- [x] 2026-04-19 — пути в индексе единообразно `src/app/...`; `git mv` не нужен. (#—)

---

## 3. Horizon 1 — Достройка запущенного

Вещи, которые уже заявлены в схеме/доках, но в коде либо заглушка,
либо отсутствует рантайм.

### Job runner

- [x] 2026-04-19 (#—) База BullMQ + `treasury-tick` / `proposal-expirer` /
      `invitation-reaper` (см. §9 Done).
- [x] 2026-04-19 (#—) Cron `auto-promotion` — `src/core/auto-promotion.ts`,
      `src/jobs/auto-promotion.ts`.
- [x] 2026-04-19 (#—) Cron `role-tax-monthly` — `src/modules/wallet/role-tax-tick.ts`.
- [x] 2026-04-19 (#—) SMTP `magic_email` — `src/core/magic-email-smtp.ts`.
- [x] 2026-04-19 (#—) Автобэкап: ежедневный snapshot в S3/R2 + ретенция
      (`BackupService`, BullMQ `backup-daily`, `BackupManifest`).

### Realtime

- [x] 2026-04-19 — WebSocket gateway `npm run ws:gateway`
      (`scripts/ws-gateway.ts`): `PSUBSCRIBE krwn:events:*`, фильтрация
      `core.chat.*` / `core.activity.recorded` как в SSE-роутах.
- [x] 2026-04-19 — Клиенты: `useChat` и `/dashboard` — WS при
      `NEXT_PUBLIC_KRWN_WS_URL`, иначе SSE; CSP `connect-src` допускает
      `ws:`/`wss:`.
- [x] 2026-04-19 — `RedisEventBus` при старте Next.js
      (`src/lib/redis-event-bootstrap.ts` + `instrumentation.ts`), если
      задан `REDIS_URL` и не `KRWN_REDIS_EVENT_BUS=0`.
- [x] 2026-04-19 — Presence: опциональный Redis (`krwn:presence:*`,
      TTL) при `REDIS_URL` и не `KRWN_PRESENCE_REDIS=0`;
      `snapshot()` async + `GET /api/state/pulse`.

### UX админки

- [x] 2026-04-19 (#—) Vertical Editor на `reactflow` — drag-and-drop
      дерева (смена parent и order соседей), одно атомарное сохранение
      `PUT /api/admin/vertical/tree`, подсветка конфликтов до сохранения,
      доступ через `permissionsEngine.can(system.admin)`.
- [x] 2026-04-20 (#—) Единый экран «Граждане» (`/admin/citizens`,
      `GET/POST /api/admin/citizens`): kick, ban / unban (`StateUserBan`),
      перевод между узлами, `pending → active` (как `/api/register/admit`),
      смена `title`, merge дубликатов (идемпотентно); Pulse-события
      `kernel.membership.*` / `kernel.user.banned_in_state` / `kernel.users.merged_in_state`;
      ключи `members.*` в `registerCorePermissions()`. См. `docs/DATABASE.md`.

### Заявленное, но не доделанное

- [x] 2026-04-20 (#—) UI и flow для `exitRefundRate` (эмиграция):
      `/dashboard/emigration`, `POST /api/state/emigrate` (сплит баланса по
      конституции, снятие членств, отзыв CLI-токенов State).
- [x] 2026-04-20 (#—) UI и flow для `rolesPurchasable` (роль-маркет):
      `/dashboard/role-market`, `POST /api/state/purchase-role` (плата =
      `citizenshipFeeAmount`, казна целевого узла; только из Прихожей).

---

## 4. Horizon 2 — Опыт Суверена и гражданина

- [x] 2026-04-20 (#—) PWA MVP: `public/manifest.webmanifest` + `public/sw.js`
      (офлайн read-кэш `GET /api/state/pulse`, ключ кэша по `Authorization`
      — см. `docs/ARCHITECTURE.md` §8), installability, CSP `worker-src` /
      `manifest-src`; `POST /api/push/subscribe` — заглушка; VAPID env в
      `docs/DEPLOYMENT.md`.
- [x] 2026-04-20 (#—) Responsive pass (чат и Pulse / dashboard): стек
      каналов + треда на `<md`, `min-w-0` / `overflow-x` на лентах,
      safe-area для composer и toasts, touch targets ≥44px на
      фильтрах/шапке Pulse; `e2e/smoke.spec.ts` — проверка отсутствия
      горизонтального overflow на `/dashboard` при 390px.
- [ ] Web-push (полная реализация): хранение подписок, серверная доставка
      (directive ACK, Proposal voting); сейчас только scaffold и VAPID env.
- [ ] Email-digest (ежедневный / еженедельный).
- [ ] Telegram-bot-адаптер через `CredentialsRegistry`-паттерн.
- [ ] i18n: ICU-формат, es/zh/tr, переключатель на уровне
      `StateSettings`, а не user-cookie.
- [ ] Accessibility pass: ARIA, focus-trap в модалках,
      `prefers-reduced-motion`, проверка контраста Gold-theme.
- [ ] Визуализации Pulse: объём переводов, налоговые поступления,
      явка на голосования, map-view Вертикали.
- [ ] Автоматические зарплаты: cron `TREASURY → PERSONAL` по
      расписанию.
- [ ] Подписки узлов (дочерний платит родителю) и штрафы (вычет из
      кошелька по приказу).

---

## 5. Horizon 3 — Экосистема модулей

Сейчас модули — только first-party, слитые с монорепо. Для
масштабирования нужен настоящий Registry.

- [ ] `@krwnos/sdk`: типы `KrwnModule`, `ModuleContext`, helpers для
      prisma-per-schema, тест-harness.
- [ ] Manifest `krwn.module.json` (slug, version, permissions,
      migrations path, peerDeps, ui entrypoint, schema name) +
      валидация на install.
- [ ] Sandboxing: модуль не дергает `prisma` напрямую, только через
      `ModuleContext`. Таблицы — строго в `krwn_<slug>_<stateIdPrefix>`.
- [ ] Секреты модуля — только через `ctx.secrets.get()`.
- [ ] Signed modules: `.krwn`-архив = tarball + detached Ed25519.
      CLI: `krwn module install ./finance.krwn` проверяет подпись.
- [ ] Marketplace (`modules.krwnos.com`): поиск, категории, отзывы,
      скачивание `.krwn`.

### Новые first-party модули

- [ ] `core.reports` — финансовая отчётность для инвесторов.
- [ ] `core.changelog` — «Указы» / публичный лог изменений
      конституции.
- [ ] `core.tasks` — Trello-like kanban с правами по узлам.
- [ ] `core.elections` — циклические выборы на узлы (отдельно от
      ad-hoc `core.governance`).
- [ ] `core.kyc` — опциональный gate на `/invite/accept`.

---

## 6. Horizon 4 — Федерация и рост (задел, не срочно)

- [ ] `.well-known/krwnos.json` на каждом State.
- [ ] Каталог `states.krwnos.com` (opt-in discovery).
- [ ] Federated identity: passkey-синхронизация, одна учётка видит
      членства в разных State через signed attestation.
- [ ] Embassy channels (зеркальные каналы между двумя State по
      аналогии с `ExchangePair`).
- [ ] Cloud marketplace images: DigitalOcean / Hetzner / Railway
      one-click.
- [ ] SaaS-tier `krwnos.app`: multi-tenant, Stripe-биллинг,
      автоматические tunnel-subdomain-ы, managed backups.
- [ ] Анонимные метрики сообщества (сколько State живых, средний
      размер, топ-модули).

---

## 7. Текущий спринт (Sprint 1)

### Порядок агентов (merge train)

Четыре агента идут **строго по очереди мержа**: Агент 2 не открывает
свой PR, пока PR Агента 1 не влит в `main`; Агент 3 — после Агента 2;
и так далее. Цель — не «пудрить» общий контекст и не ловить бесконечные
ребейзы на одних и тех же файлах.

| Шаг | Агент | Задача | Где в Roadmap |
|-----|-------|--------|---------------|
| 1 | **Первый** | CI на GitHub Actions + coverage `core/*` ≥ 70 % | §2 «Тесты и CI» |
| 2 | **Второй** | BullMQ + перевод `TreasuryWatcher` / `proposal-expirer` / `invitation-reaper` на воркер | §3 «Job runner» |
| 3 | **Третий** | Миграция `Float → Decimal` для денег + hot-path сервисов | §2 «Денежный контур» |
| 4 | **Четвёртый** | Security middleware: rate-limit, CSP, `/api/ready`, pino (+ request-id) | §2 «Security и observability» |

После мержа четырёх PR — **пятая** задача спринта (отдельный заход):

5. [x] 2026-04-19 (#—) Vertical Editor до состояния «можно мышью строить министерства»
       — ключевое демо-wow (§3 «UX админки»).

Чеклист статуса (обновлять в том же PR, что закрывает шаг):

- [x] Шаг 1 — Первый агент (CI + coverage)
- [x] Шаг 2 — Второй агент (BullMQ + reapers)
- [x] Шаг 3 — Третий агент (Decimal)
- [x] Шаг 4 — Четвёртый агент (security)
- [x] Шаг 5 — Vertical Editor (после шага 4) — 2026-04-19 (#—)

---

## 8. Parking lot

Идеи, которые прозвучали, но ещё не отсортированы по горизонтам.
Сюда же падают пункты из GitHub Issues с лейблом `roadmap`.

- [ ] (пусто)

---

## 9. Done

Закрытые пункты остаются здесь как changelog проекта.

### 2026-04 — Horizon 2 · PWA
- [x] 2026-04-20 (#—) PWA MVP: manifest, service worker, офлайн Pulse
      (Bearer-scoped cache), installability, push subscribe stub + VAPID env
      (`docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md` §8).

### 2026-04 — Horizon 2 · Responsive
- [x] 2026-04-20 (#—) Чат + Pulse (`ChatPanel` / `/dashboard`): колонка
      каналов над тредом на узких экранах, safe-area, touch targets,
      `overflow-x` / `min-w-0`; Playwright — отсутствие горизонтального
      overflow на `/dashboard` при 390px (`e2e/smoke.spec.ts`).

### 2026-04 — Horizon 2 · Onboarding
- [x] 2026-04-20 (#—) Onboarding-тур после `/setup`: чеклист на `/dashboard`
      (Nexus/казна → Фабрика валют → граждане → Палата Указов/налоги →
      Парламент), завершение в `StateSettings.extras`, API
      `POST /api/state/sovereign-onboarding/complete`, поля в `GET /api/state/pulse`.

### 2026-04 — Horizon 0 · Гигиена репо
- [x] 2026-04-19 — Игнор `.next/` в `.gitignore`. Проверка: `git log --all -- .next`
      пусто (артефакты не в истории `main`). Если `.next/` всё же попал в
      удалённую ветку, мейнтейнер после согласования: установить
      [git-filter-repo](https://github.com/newren/git-filter-repo), затем
      `git filter-repo --path .next/ --invert-paths` и координировать force-push.
- [x] 2026-04-19 — `compose-build.log` в `.gitignore`; `git rm --cached compose-build.log`
      (файл остаётся локально).
- [x] 2026-04-19 — Все пути приложения в индексе — `src/app/...` (прямые слеши);
      дубликатов с `src\app` или рассинхрона регистра нет.

### 2026-04 — Horizon 0 · CI
- [x] 2026-04-19 — GitHub Actions: `.github/workflows/ci.yml` (Postgres
      service + `prisma migrate deploy`, lint, typecheck, vitest coverage
      с порогами на ядро, production `next build`).

### 2026-04 — Horizon 0 · modules/wallet
- [x] 2026-04-19 (#—) Тесты `modules/wallet`: атомарный налог в корневую
      казну (`transactionTaxRate` + `asset.taxRate`, Decimal), гонки
      параллельных переводов, прямой `executeTransfer` с налогом
      (`src/modules/wallet/__tests__/wallet.integration.test.ts` при
      `TEST_DATABASE_URL`); ветка ON_CHAIN / intent-flow без RPC
      (`src/modules/wallet/__tests__/wallet.service.test.ts`, mock
      `ChainProviderRegistry`).
- [x] 2026-04-19 — E2E smoke (Playwright): `e2e/smoke.spec.ts` — `/setup`
      (успех + редирект «уже настроено»), `/invite/[token]`, `/admin/nexus`
      (prompt без токена + доступ с bootstrap CLI-токеном), `GET /api/admin/nexus`
      (401 / 200); в CI: Redis service, `npx playwright install --with-deps
      chromium`, шаг после `next build`. Команда локально: `npm run build &&
      npm run test:e2e` (см. `docs/SETUP.md`).

### 2026-04 — Horizon 0 · modules/wallet (Decimal / гонки)
- [x] 2026-04-19 — Расширенные интеграционные тесты: параметризованные
      суммы и округление налога в корневую Казну, прямые `executeTransfer`
      с дробными `Decimal` (18 dp), конкурентные transfer (один пул и два
      клиента Prisma); условное списание `balance >= amount` в
      `repo.executeTransfer`. Файл: `src/modules/wallet/__tests__/wallet.integration.test.ts`;
      прогон в CI (`GITHUB_ACTIONS` + `TEST_DATABASE_URL`) или локально
      `KRWN_INTEGRATION=1` (быстрый `npm test` без флага не трогает БД).

### 2026-04 — Horizon 0 · core/backup
- [x] 2026-04-19 — Полный round-trip слепка: экспорт `BackupService` +
      `restoreBackupPayload` в пустую схему; в снимок включён `themeConfig`;
      Prisma-адаптеры в `src/core/backup-prisma.ts`; проверка в
      `src/core/__tests__/setup-state.integration.test.ts` (нужен
      `TEST_DATABASE_URL`).

### 2026-04 — Horizon 0 · core/setup-state
- [x] 2026-04-19 — `core/setup-state`: идемпотентность (`AlreadyInitialisedError`),
      атомарный bootstrap в `prisma.$transaction`, unit-мок сбоя внутри tx;
      опциональная интеграция с Postgres через `TEST_DATABASE_URL`
      (`src/core/__tests__/setup-state.test.ts`,
      `src/core/__tests__/setup-state.integration.test.ts`).

### 2026-04 — Horizon 0 · Security и observability
- [x] 2026-04-19 — Audit CSRF для non-idempotent App-Router routes:
      инвентаризация `POST`/`PATCH`/`DELETE` и политика в
      `docs/ARCHITECTURE.md` §7; same-origin guard
      `src/lib/same-origin-mutation.ts` на `POST /api/register`,
      `POST /api/setup`, `POST /api/invite/:token/accept`; тесты
      `src/lib/__tests__/same-origin-mutation.test.ts`. (#PR)
- [x] 2026-04-19 — Rate limiting (Redis fixed-window + Lua, ioredis) на
      `POST /api/register`, `POST /api/invite/[token]/accept`,
      `GET|POST /api/setup`, `/api/cli/*`; при недоступности Redis —
      fail open (`src/lib/rate-limit.ts`).
- [x] 2026-04-19 — CSP + базовые security headers в `next.config.mjs`;
      `x-request-id` в `src/middleware.ts`.
- [x] 2026-04-19 — Pino (`src/lib/logger.ts`, `LOG_LEVEL`) + корреляция
      по `x-request-id` (см. `childLoggerFromRequest` в `/api/ready`).
- [x] 2026-04-19 — `GET /api/ready` — readiness (PostgreSQL + Redis PING);
      `GET /api/health` без изменений (liveness / БД).
- [x] 2026-04-19 — AEAD для модульных секретов: HKDF + AES-256-GCM
      (`src/core/module-secret-vault.ts`); тест подмены `AUTH_SECRET`
      (`src/core/__tests__/module-secret-vault.test.ts`). (#PR)
- [x] 2026-04-19 — OpenTelemetry: `src/instrumentation.ts` + Node SDK
      (`src/lib/otel/start-node-sdk.ts`) — dev: `ConsoleSpanExporter`, prod: OTLP/HTTP
      через `OTEL_EXPORTER_OTLP_*` и опционально `OTEL_EXPORTER_OTLP_HEADERS`;
      `experimental.instrumentationHook` в `next.config.mjs`; переменные в
      `docs/DEPLOYMENT.md`. (#PR)

### 2026-04 — Horizon 1 · UX админки (Audit)
- [x] 2026-04-20 (#—) `/admin/audit` — фильтры, экспорт CSV/JSON по текущим фильтрам (до 10k строк, UTF-8 BOM), семантика колонок в UI; `GET /api/activity?audit=1` для полного журнала (Суверен / `system.admin`) с сохранением ретенции; `KRWN_ACTIVITY_LOG_RETENTION_DAYS` + BullMQ `activity-log-reaper`; `viewer.canAuditLog` в `GET /api/state/pulse` (`docs/DATABASE.md`).

### 2026-04 — Horizon 1 · UX админки (Vertical Editor)
- [x] 2026-04-19 (#—) `/admin/vertical-editor`: React Flow — перетаскивание узлов,
      смена родителя и порядка соседей, черновик + «Сохранить структуру»
      одним вызовом `PUT /api/admin/vertical/tree` (транзакция Prisma),
      превью конфликтов (цикл, перенос прихожей); gate через
      `permissionsEngine.can(system.admin)` (`src/app/api/state/_context.ts`).

### 2026-04 — Horizon 1 · UX админки (Citizens)
- [x] 2026-04-20 (#—) `/admin/citizens` + `GET/POST /api/admin/citizens`:
      kick / ban / unban (`StateUserBan`), move, admit (`pending → active`),
      edit title, merge duplicates; `members.*` в `registerCorePermissions()`;
      Pulse: `kernel.membership.revoked|moved`, `kernel.user.banned_in_state` /
      `unbanned`, `kernel.users.merged_in_state`;
      блокировки: `GET /api/state/pulse`, `POST /api/register`, accept invite
      при активном бане.

### 2026-04 — Horizon 1 · Magic email (SMTP)
- [x] 2026-04-19 — SMTP-транспорт для `magic_email`: `SMTP_HOST`, `SMTP_PORT`,
      `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (только из env);
      `src/core/magic-email-smtp.ts` (`readSmtpEnv`, `createSmtpTransport`,
      `sendMagicEmail`); unit-тест с mock `Transporter`. (#—)

### 2026-04 — Horizon 1 · Job runner (BullMQ)
- [x] 2026-04-19 (#—) Автобэкап: cron `backup-daily` (дефолт `0 3 * * *` UTC),
      `BackupService` + S3-совместимое хранилище (`@aws-sdk/client-s3`), запись
      `BackupManifest`, ретенция по `KRWN_BACKUP_RETENTION_COUNT` (удаление
      старых объектов и строк). Без `KRWN_BACKUP_S3_BUCKET` + ключей — no-op.
- [x] 2026-04-19 (#—) Cron `roleTaxRate`: очередь `role-tax-monthly`, repeat через
      `upsertJobScheduler` (`KRWN_JOB_ROLE_TAX_CRON`, дефолт `0 0 1 * *`,
      `KRWN_JOB_ROLE_TAX_TZ`), списание доли баланса личного кошелька (первичный
      актив) в корневую казну по `StateSettings.roleTaxRate`; идемпотентность
      по месяцу UTC (`periodKey` YYYY-MM) в `RoleTaxPeriodCharge`
      (`src/modules/wallet/role-tax-tick.ts`, `src/jobs/worker.ts`, `src/jobs/tasks.ts`).
- [x] 2026-04-19 — BullMQ + Redis: очередь `krwn-jobs`, воркер
      `npm run worker:jobs` (`scripts/job-worker.ts`, `src/jobs/*`).
      Планировщики: `treasury-tick` (`TreasuryWatcher.tick`),
      `proposal-expirer` (`GovernanceService.tickDueProposals`, в т.ч.
      `auto_dao`), `invitation-reaper` (просроченные `Invitation` →
      `expired`), `auto-promotion`, `role-tax-monthly`, `backup-daily`
      (см. отдельные пункты выше). Лидер регистрации cron через `KRWN_JOB_LEADER`
      (см. заголовок `scripts/job-worker.ts`). CLI `watcher:treasury`
      остаётся для ручного/демон-режима без Redis.
- [x] 2026-04-19 — Cron `auto-promotion`: по `StateSettings`
      (`autoPromotionEnabled`, `autoPromotionMinBalance` /
      `autoPromotionMinDays`, `autoPromotionTargetNodeId`) обход
      активных `Membership`, перенос в целевой узел при выполнении
      порогов; правила в `src/core/auto-promotion.ts`, задача
      `src/jobs/auto-promotion.ts`, планировщик `KRWN_JOB_AUTO_PROMOTION_EVERY_MS`
      (дефолт 300000 мс). (#—)

### 2026-04 — Phase 4.5 · Economy + Governance v0.1
- [x] Currency Factory (INTERNAL / ON_CHAIN / HYBRID).
- [x] Кошельки (PERSONAL / TREASURY) + режимы прозрачности.
- [x] Автоматический налог в корневую Казну в одной БД-транзакции.
- [x] Krwn Exchange Engine: направленные пары, «санкции», cross-state
      transfer.
- [x] Палата Указов (`StateSettings` как типизированные колонки).
- [x] `core.governance`: `decree` / `consultation` / `auto_dao`,
      вето Суверена, snapshot правил на момент создания предложения.
- [x] State Pulse (Activity Feed) + Event Bus intake.
- [x] Theme Engine (пресеты + кастомные токены в `themeConfig`).

### 2026-03 — Phase 4 · Sovereign Node
- [x] Три tier-а установки: Sandbox / Pro / Cloud (concept +
      install-скрипты + compose).
- [x] `@krwnos/cli` (`krwn login / module / vertical / invite /
      backup / token / status`).
- [x] Magic-link invitations + QR-коды, SHA-256 hashing.
- [x] Credentials Registry (passkey, wallet_ethereum,
      wallet_solana, oauth_github, oauth_google, magic_email).
- [x] TunnelManager: cloudflared / frp / ngrok / tailscale funnel.
- [x] BackupService (versioned JSON snapshot).
- [x] Schema-per-module изоляция.

### Phase 3 · Module System
- [x] Bootstrap в `src/modules/index.ts` через `registry.register()`.
- [x] `core.chat` — каналы, директивы, ack.
- [x] Widget Shell (динамический desktop).

### Phase 2 · Vertical Management
- [x] CRUD узлов с проверкой прав через Permissions Engine.
- [x] `Membership` с `active` / `pending` статусами.
- [x] Lobby-узел (Прихожая) для открытых регистраций.

### Phase 1 · Foundation
- [x] Next.js 14 App Router + Tailwind.
- [x] `src/types/kernel.ts` — типовая модель ядра.
- [x] `PermissionsEngine` с `walkUp` и wildcard'ами.
- [x] `ModuleRegistry` и `EventBus` (in-memory + Redis).
- [x] `prisma/schema.prisma` — State, VerticalNode, Membership,
      InstalledModule.
- [x] Auth adapter через `setAuthAdapter()`.
