# KrwnOS — Roadmap

> Живой документ. Единственный источник правды по плану развития.
> `WHITEPAPER.md` описывает, ЧТО система умеет сейчас.
> `ROADMAP.md` описывает, ЧТО будет и в каком порядке.

**Обновлено:** 2026-04-19
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

- [ ] Настроить GitHub Actions (`.github/workflows/ci.yml`): lint +
      typecheck + vitest + prisma validate + build.
- [ ] `core/permissions-engine` — `walkUp`, `*`, wildcard, pending,
      circular graph.
- [ ] `core/setup-state` — идемпотентность, rollback при сбое.
- [ ] `core/invitations` — TTL, `maxUses`, повторная консумация,
      revoked.
- [ ] `core/backup` — round-trip snapshot → restore в чистую БД.
- [ ] `modules/wallet` — атомарный налог в Казну, race на
      параллельных переводах, ON_CHAIN intent-flow.
- [ ] `modules/governance` — snapshot правил, три режима, сюжет
      с вето.
- [ ] E2E (Playwright) для `/setup`, `/invite/[token]`,
      `/admin/nexus`.

### Денежный контур

- [x] 2026-04-19 Миграция `Float` → `Decimal` для `Wallet.balance` и
      `Transaction.amount` (`prisma/migrations/20260422100000_wallet_ledger_decimal`).
- [x] 2026-04-19 Hot-path: `WalletService.transfer`, `repo.executeTransfer`,
      Krwn Exchange adapter, citizenship fee, pulse/nexus aggregates,
      Treasury Watcher dust — на `Prisma.Decimal` / `ledgerDecimal`.
- [ ] Прогнать расширенные тесты на округление налогов и гонки
      двойных списаний (отдельный прогон / CI).

### Security и observability

- [ ] Rate-limit middleware (ioredis token-bucket) на
      `/api/register`, `/api/invite/*/accept`, `/api/setup`,
      `/api/cli/*`.
- [ ] CSP + security headers в `next.config.mjs`.
- [ ] Audit CSRF для non-idempotent App-Router routes.
- [ ] Тест AEAD-шифрования модульных секретов (подмена
      `AUTH_SECRET` → падение).
- [ ] Structured logger (pino) + request-id middleware.
- [ ] OpenTelemetry traces (stdout в dev, OTLP в prod).
- [ ] `/api/ready` (проверка БД + Redis) рядом с `/api/health`.

### Гигиена репо

- [ ] Удалить `.next/` из истории гита, проверить `.gitignore`.
- [ ] `compose-build.log` → `.gitignore`.
- [ ] Навести порядок в дублирующихся путях (`src\app\...` vs
      `src/app/...` в git status — слеши на Windows).

---

## 3. Horizon 1 — Достройка запущенного

Вещи, которые уже заявлены в схеме/доках, но в коде либо заглушка,
либо отсутствует рантайм.

### Job runner

- [ ] Cron: `autoPromotion` (гражданин → выше по `minBalance`/
      `minDays`).
- [ ] Cron: `roleTaxRate` ежемесячный тиккер.
- [ ] SMTP-транспорт для `magic_email` provider.
- [ ] Автобэкап: ежедневный snapshot в S3/R2 + ретенция.

### Realtime

- [ ] WebSocket gateway (отдельный воркер) с подпиской на
      `RedisEventBus`.
- [ ] Переключить `core.chat` и Pulse на WS; SSE оставить как
      fallback.
- [ ] Presence (`src/server/presence.ts`) — вынести на Redis.

### UX админки

- [ ] Vertical Editor на `reactflow` — полноценный drag-and-drop с
      атомарным пересохранением и подсветкой сломанных прав.
- [ ] `/admin/audit` — фильтры, экспорт CSV, ретенция.
- [ ] Единый экран «Граждане»: kick, ban, перевод между узлами,
      `pending → active`, смена `title`, merge дубликатов.

### Заявленное, но не доделанное

- [ ] UI и flow для `exitRefundRate` (эмиграция).
- [ ] UI и flow для `rolesPurchasable` (роль-маркет).

---

## 4. Horizon 2 — Опыт Суверена и гражданина

- [ ] Onboarding-тур после `/setup`: «создай Казначейство → валюту →
      первых граждан → налоги → Парламент».
- [ ] PWA: `manifest.webmanifest`, service-worker (офлайн Pulse),
      web-push.
- [ ] Responsive pass (чат и Pulse — основное потребление с
      телефона).
- [ ] Web-push уведомления для directive ACK и Proposal voting.
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

5. [ ] Vertical Editor до состояния «можно мышью строить министерства»
       — ключевое демо-wow (§3 «UX админки»).

Чеклист статуса (обновлять в том же PR, что закрывает шаг):

- [ ] Шаг 1 — Первый агент (CI + coverage)
- [x] Шаг 2 — Второй агент (BullMQ + reapers)
- [ ] Шаг 3 — Третий агент (Decimal)
- [ ] Шаг 4 — Четвёртый агент (security)
- [ ] Шаг 5 — Vertical Editor (после шага 4)

---

## 8. Parking lot

Идеи, которые прозвучали, но ещё не отсортированы по горизонтам.
Сюда же падают пункты из GitHub Issues с лейблом `roadmap`.

- [ ] (пусто)

---

## 9. Done

Закрытые пункты остаются здесь как changelog проекта.

### 2026-04 — Horizon 1 · Job runner (BullMQ)
- [x] 2026-04-19 — BullMQ + Redis: очередь `krwn-jobs`, воркер
      `npm run worker:jobs` (`scripts/job-worker.ts`, `src/jobs/*`).
      Планировщики: `treasury-tick` (`TreasuryWatcher.tick`),
      `proposal-expirer` (`GovernanceService.tickDueProposals`, в т.ч.
      `auto_dao`), `invitation-reaper` (просроченные `Invitation` →
      `expired`). Лидер регистрации cron через `KRWN_JOB_LEADER`
      (см. заголовок `scripts/job-worker.ts`). CLI `watcher:treasury`
      остаётся для ручного/демон-режима без Redis.

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
