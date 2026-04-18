# KrwnOS — White Paper

> Операционная система для цифровых государств.
> Одна установка — одно суверенное сообщество со своими законами,
> деньгами, парламентом и границами.

**Версия документа:** 0.1 · MVP Foundation
**Дата:** 2026-04-19
**Статус:** Phase 1–4 завершены, Phase 5 в работе

---

## 0. TL;DR — что это такое, если у вас 30 секунд

KrwnOS — это self-hosted платформа, на которой один человек
(«Суверен») может за 60 секунд создать собственное **цифровое
государство**: кланы, компании, DAO, сообщества, гильдии,
внутренние экономики, закрытые клубы.

Внутри каждого такого государства есть:

- **Вертикаль власти** — графовая иерархия должностей, отделов
  и рангов, по которой сверху вниз наследуются права.
- **Своя валюта** — либо чисто виртуальная (живёт в Postgres),
  либо привязанная к реальному токену на блокчейне (ERC-20 / SPL),
  либо гибридная — мгновенные внутренние переводы с возможностью
  вывода «наружу».
- **Казначейство и налоги** — бюджеты узлов, автоматический
  сбор налогов с транзакций, подоходный налог, режимы
  прозрачности Казны.
- **Парламент** — настраиваемый DAO: от чисто декоративного
  («жалобная книга») до автоматически применяющего решения с
  правом вето у Суверена.
- **Чат с приказами** — каналы, привязанные к узлам Вертикали;
  старший по званию публикует «директиву» — подчинённые обязаны
  нажать «принято к исполнению».
- **Межгосударственная биржа (Krwn Exchange)** — два разных
  государства могут установить курс обмена своих валют,
  объявить торговое соглашение или экономическую блокаду.
- **Magic-link приглашения** — один URL или QR вместо
  «логин/пароль/подтверди email».
- **CLI `krwn`** — пульт управления государством из терминала.

Запускается тремя способами: `docker compose up`, `curl | bash`
на VPS, one-click в облаке.

---

## 1. Проблема

Современные сообщества (кланы, команды, DAO, локальные компании,
гильдии, клубы) вынуждены склеивать себя из 5–10 сервисов:
Discord/Slack для общения, Notion для иерархии, Google Forms
для голосований, таблицы для «внутренней валюты», Telegram-боты
для приказов, внешние кошельки для казны. Результат:

- Данные разбросаны по SaaS, которые вас не знают и могут
  забанить завтра.
- Роли и права нигде не являются первоклассной сущностью.
  Каждый сервис реализует их по-своему, между ними нет связи.
- Нет «денежного контура»: внутренний токен клана — это
  картинка в таблице, а не актив, который реально можно
  перевести, обложить налогом или обменять.
- Масштабирование = заставить всех переучиться заново.

**Наш тезис:** сообщество — это государство. А значит, ему
нужна операционная система, у которой Вертикаль власти,
Деньги и Закон — первоклассные примитивы, а не надстройки
над чатом.

---

## 2. Ответ: четыре кита KrwnOS

| Кит | Что это | Первоклассная сущность |
|-----|---------|------------------------|
| **The State** | Изолированный инстанс со своим владельцем, своими правилами и своим набором модулей. | `State` |
| **The Vertical** | Графовая иерархия узлов. Права наследуются сверху вниз через `walkUp()`. | `VerticalNode` + `Membership` |
| **The Kernel** | Auth · Permissions · Event Bus · Module Registry. Ядро ничего не знает о плагинах. | `src/core/*` |
| **The Modules** | Плагины с собственными правами, виджетами и событиями: чат, кошельки, биржа, парламент. | `KrwnModule` + `registry.register()` |

Визуально:

```
┌──────────── The State (один инстанс) ────────────────┐
│                                                      │
│  ┌──────── The Vertical ─────────┐                   │
│  │  Sovereign (корень, "*")      │                   │
│  │    ├── Ministry of Finance    │                   │
│  │    │    ├── Treasurer         │                   │
│  │    │    └── Auditor           │                   │
│  │    └── Citizens (rank)        │                   │
│  └───────────────────────────────┘                   │
│                                                      │
│  ┌──────── Installed Modules ────┐                   │
│  │  core.chat · core.wallet ·    │                   │
│  │  core.governance · ...        │                   │
│  └───────────────────────────────┘                   │
│                                                      │
│  ┌──────── Палата Указов ────────┐                   │
│  │  налоги · правила входа ·     │                   │
│  │  динамика Вертикали · DAO     │                   │
│  └───────────────────────────────┘                   │
└──────────────────────────────────────────────────────┘
```

Подробнее: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 3. Архитектурные принципы

**Hexagonal / Modular Monolith.**

1. `core/*` зависит только от `types/*` и `lib/*`. Никогда не
   импортирует ничего из `modules/*`.
2. `modules/*` зависит только от `types/*` и публичных
   экспортов `core/*`.
3. Связывание ядра и плагинов — ровно одна строка в
   `src/modules/index.ts`: `registry.register(coreChatModule)`.
4. Никаких `if (user.role === "admin")` — только
   `permissionsEngine.can(ctx, "finance.read")`.
5. Каждое право декларируется модулем в `init()`. Проверять
   незаявленное право — ошибка ядра.

**Inversion of control:** модуль получает всё, что ему нужно
(текущий пользователь, права, event bus, logger), через
`ModuleContext`. Он не тянет Prisma/Redis напрямую.

---

## 4. Что реально реализовано (Phase 1–4)

### 4.1 Ядро (`/src/core`)

| Компонент | Файл | Что делает |
|-----------|------|------------|
| **PermissionsEngine** | `permissions-engine.ts` | `can()` / `resolveAll()` с `walkUp()` по Вертикали. Супер-право `*` у Суверена. Wildcard `finance.*`. |
| **Auth** | `auth.ts` | Абстракция над провайдером. Регистрация через `setAuthAdapter()`. Никакой привязки к NextAuth/Clerk на уровне ядра. |
| **CredentialsRegistry** | `auth-credentials.ts` | Плагинные провайдеры: passkey (WebAuthn), Ethereum/Solana wallet (SIWE), GitHub/Google OAuth, magic email. |
| **Event Bus** | `event-bus.ts` | `InMemoryEventBus` + `RedisEventBus`. Канонические `KernelEvents`. |
| **Module Registry** | `registry.ts` | Единственный источник истины по установленным плагинам и их правам. |
| **InvitationsService** | `invitations.ts` | Magic links + QR-коды. SHA-256 хранение токенов, коды вида `KRWN-7HX2-9KQ4`. |
| **BackupService** | `backup.ts` | Versioned JSON snapshot всего State. |
| **TunnelManager** | `tunneling.ts` | Адаптеры: cloudflared · frp · ngrok · tailscale funnel. |
| **CliTokenService** | `cli-tokens.ts` | Скоупированные токены для CLI, ротация без grace-периода. |
| **StateConfigService** | `state-config.ts` | Палата Указов: фискальная политика, динамика Вертикали, правила входа. |
| **ExchangeService** | `exchange.ts` | Krwn Exchange Engine — межгосударственные переводы, «санкции» через `enabled: false` в паре. |
| **GovernanceRules** | `governance-rules.ts` | Типы и валидация конституции DAO: `decree` / `consultation` / `auto_dao`, кворум, threshold, whitelist ключей. |
| **setupState** | `setup-state.ts` | Атомарный first-run bootstrap: User + State + root VerticalNode + Membership + CliToken. |

### 4.2 База данных (`/prisma/schema.prisma`)

Одна PostgreSQL база, изолированная по `stateId` на уровне
каждой записи. Ключевые модели:

- **User · State · VerticalNode · Membership** — ядро.
- **AuthCredential · CliToken · Invitation** — аутентификация и
  приглашения.
- **InstalledModule** (+ поле `dbSchema` для изоляции приватных
  таблиц модулей).
- **StateSettings** — 1:1 с State. Типизированные колонки для
  hot-path (`transactionTaxRate`, `incomeTaxRate`,
  `citizenshipFeeAmount`, `treasuryTransparency`, …) + JSON
  `governanceRules`.
- **ChatChannel · ChatMessage · ChatDirectiveAck** — чат и
  приказы.
- **StateAsset · Wallet · Transaction** — Currency Factory.
  Типы: `INTERNAL` / `ON_CHAIN`. Режимы: `LOCAL` / `EXTERNAL` /
  `HYBRID`. Кошельки: `PERSONAL` / `TREASURY`.
- **ExchangePair · CrossStateTransaction** — Krwn Exchange
  Engine. Направленные пары («санкция» = `enabled=false`).
- **Proposal · Vote** — Core Governance (Парламент).
- **BackupManifest · Tunnel** — операционные.

Изоляция данных — см. [`ISOLATION.md`](./ISOLATION.md):
Schema-per-module + обязательный `where: { stateId }` во всех
ядерных запросах.

### 4.3 Модули-первопартийцы (`/src/modules`)

| Slug | Что умеет | Ключевые права |
|------|-----------|----------------|
| `core.chat` | Каналы, привязанные к узлам Вертикали (видят члены узла + предки). Директивы (формальные приказы) со строкой подтверждения у каждого подчинённого. Markdown-рендер. | `chat.read`, `chat.write`, `chat.admin`, `chat.directive.issue`, `chat.directive.ack` |
| `core.wallet` | Currency Factory (создание валют Сувереном). Личные кошельки, казначейства узлов. Переводы внутри ledger'а с атомарным налогом в корневую Казну. Эмиссия / сжигание. On-chain провайдеры (EVM, Solana) для HYBRID-активов. Виджет навбара со списком балансов. | `wallet.view`, `wallet.transfer`, `wallet.view_treasury`, `wallet.admin_mint`, `wallet.admin_burn`, `wallet.currency.manage` |
| `core.governance` | Предложения → голосование → исполнение. Три режима (декрет / консультация / auto-DAO). Кворум + threshold в bps. Стратегии веса голоса: one-person-one-vote / by-node-weight / by-balance. Право вето у Суверена. | `governance.propose`, `governance.vote`, `governance.veto`, `governance.execute`, `governance.manage` |

### 4.4 Web (App Router)

- `/setup` — web-wizard коронации Суверена (single-page).
- `/invite/[token]` — passkey/wallet challenge + accept.
- `/admin/economy` — Currency Factory + налоги + казначейства.
- `/admin/nexus` — Палата Указов: все параметры конституции в
  одном месте.
- API-роуты:
  - `/api/setup` — first-run.
  - `/api/register` — регистрация гражданина.
  - `/api/invite/[token]/accept` — консумация приглашения.
  - `/api/chat/*` — каналы, сообщения, директивы, ack.
  - `/api/wallet/*` — кошельки, переводы, казначейства,
    assets, mint/burn, supply.
  - `/api/governance/*` — proposals, votes, execute, veto.
  - `/api/admin/nexus` — StateSettings.
  - `/api/cli/*` — CLI endpoints (token rotate, status,
    invite, vertical).
  - `/api/health` — healthcheck.

### 4.5 CLI (`/cli`)

Пакет `@krwnos/cli` (`krwn`). Node ≥ 20, без сторонних
зависимостей (parseArgs из `node:util`, встроенный fetch).

```bash
krwn login --host https://myclan.krwnos.app --token kt_xxx
krwn module install finance
krwn vertical add "Ministry of Defense" --type department
krwn invite --node ver_recruit --ttl 7d --max-uses 25
krwn backup --out ./state.json
krwn token rotate --label "daily-ops"
krwn status
```

Все команды — скоупированные токены, принцип минимальных
привилегий. Подробнее: [`CLI.md`](./CLI.md).

### 4.6 Развёртывание

Три тира. Подробнее: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

| Tier | Кому | Как | DNS |
|------|------|-----|-----|
| **Sandbox** | локальные кланы, тесты | `docker compose up` | `localhost` |
| **Pro** | свой VPS | `curl -sSL https://get.krwnos.com \| bash` | ваш домен / Cloudflare Tunnel |
| **Cloud** | под ключ | one-click в DO / Linode / AWS | `*.krwnos.app` |

Скрипты установки: `scripts/install.sh` (Linux/macOS),
`scripts/install.ps1` (Windows). Compose-стек — в `deploy/`.
Публичные landing и install-скрипты — в `deploy/web/`.

---

## 5. Три главных потока (как этим пользоваться)

### 5.1 «Я хочу поднять своё государство за 5 минут»

```bash
git clone https://github.com/KrwnOS/krwnos.git
cd krwnos/deploy
cp .env.example .env                          # впишите AUTH_SECRET
docker compose up -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run setup
# ↑ выведет CLI-токен. Сохраните и сразу ротируйте:
krwn login --host http://localhost:3000 --token <что-выдали>
krwn token rotate --label "daily-ops"
```

Откройте `http://localhost:3000` — вы Суверен. Вертикаль
уже имеет корневой узел `Sovereign` с правом `*`.

### 5.2 «Я хочу пригласить людей»

```bash
krwn vertical add "Citizens" --type rank
krwn vertical add "Recruits" --parent <citizens-id> --type rank
krwn invite --node <recruits-id> --ttl 7d --max-uses 25 \
            --label "Wave 1"
```

CLI покажет URL и короткий код (`KRWN-XXXX-XXXX`). Отправьте
ссылку — получатель попадает на `/invite/<token>`, проходит
passkey/wallet-challenge, создаётся `Membership` в узле.
UI после этого собирается под его роль.

### 5.3 «Я хочу, чтобы у нас была своя валюта и налоги»

1. `/admin/economy` → **Currency Factory** → создать
   `StateAsset` (`symbol: KRN`, `type: INTERNAL`, `mode: LOCAL`,
   пометить `isPrimary`).
2. `/admin/nexus` → **Палата Указов** → выставить
   `transactionTaxRate = 0.02` (2%), `incomeTaxRate = 0.1`
   (10%).
3. Любой перевод через `WalletService.transfer()` теперь
   автоматически отделяет 2% в корневую Казну в той же БД-
   транзакции. Выплаты из Казны на личный кошелёк (subtype
   `treasury_allocation`) режутся на 10% подоходного.
4. Включить «Парламент»: `/admin/nexus` →
   `governanceRules.mode = "consultation"` или `"auto_dao"`,
   задать `quorumBps`, `thresholdBps`, `weightStrategy`,
   whitelist ключей, которые DAO может менять.

### 5.4 «Я хочу торговать с соседним государством»

Два разных инстанса KrwnOS (каждый со своим Сувереном) могут
устанавливать курсы обмена:

```
State A: asset KRN (INTERNAL)
State B: asset GLD (INTERNAL)

Суверен A:  Exchange.upsertPair({ from: KRN, to: GLD, rate: 0.5 })
Суверен B:  Exchange.upsertPair({ from: GLD, to: KRN, rate: 1.9 })
                                                  // ↑ может не открыть
                                                  //   reverse direction
                                                  //   = экономическая
                                                  //   блокада

Гражданин A:  Exchange.crossStateTransfer(KRN 100 → GLD @0.5)
                                                  // burn 100 KRN в A,
                                                  // mint 50 GLD в B
```

Запись в глобальном `CrossStateTransaction` + два per-state
`Transaction` (burn в source, mint в destination).

---

## 6. Модель безопасности и разрешений

### 6.1 Как принимается решение «можно ли?»

```
can(user, permission):
  if user is Sovereign of this State → true
  for each membership (user, node) with status=active:
    for each ancestor in walkUp(node):
      if ancestor.permissions contains permission
         or "<domain>.*" or "*":
        return true
  return false
```

Ключевые особенности:

- **Одна форма проверки во всей системе.** Никаких ролей по
  имени, никаких хардкодов.
- **Наследование сверху вниз.** Министр финансов видит всё,
  что видит казначей, потому что казначей — его потомок в
  Вертикали.
- **Pending-члены ничего не видят.** Когда пользователь
  регистрируется открытой ссылкой, он падает в «Прихожую»
  (`VerticalNode.isLobby = true`) со статусом `pending` —
  permissions не работают, пока старший не переведёт в
  `active`.
- **Wildcard у Суверена.** Корневой узел имеет `permissions = ["*"]`.
- **Suverenнoe вето.** Даже в auto-DAO Суверен может откатить
  решение, если `sovereignVeto = true`.

### 6.2 Аутентификация

Passwordless by default. `CredentialsRegistry` поддерживает:

- `passkey` (WebAuthn)
- `wallet_ethereum` (SIWE)
- `wallet_solana`
- `oauth_github` / `oauth_google`
- `magic_email`

Каждый provider — отдельный объект, регистрируется при
bootstrap. Ядро ничего не знает о конкретных библиотеках.

### 6.3 Изоляция данных

- Все ядерные запросы — с `where: { stateId }`.
- Приватные таблицы модуля живут в отдельной Postgres-схеме
  (`krwn_<slug>_<stateIdPrefix>`). `DROP SCHEMA CASCADE` =
  чистое удаление модуля.
- Секреты модуля (API keys, webhook URLs) — шифруются
  application-level AEAD с ключом из `AUTH_SECRET`.

Подробнее: [`ISOLATION.md`](./ISOLATION.md).

---

## 7. Устройство денежного контура

### 7.1 Currency Factory

Каждое государство само решает, что считать деньгами.
`StateAsset.type × StateAsset.mode` даёт три осмысленные
комбинации:

| type | mode | Смысл | Когда брать |
|------|------|-------|-------------|
| `INTERNAL` | `LOCAL` | Чисто виртуальная валюта в Postgres. Быстро, бесплатно, никаких цепей. | Клубы, кланы, закрытые компании, внутренние очки. |
| `ON_CHAIN` | `EXTERNAL` | Зеркало реального токена на цепи (ERC-20 / SPL). Балансы синкает Treasury Watcher. | Когда нужна публичная ликвидность и настоящий блокчейн-аудит. |
| `INTERNAL` | `HYBRID` | Баланс мгновенно двигается в БД, но есть `exchangeRate` для вывода на цепь. | Геймификация + настоящий вывод «наружу» по требованию. |

**Knobs Сувереня:** `canMint`, `taxRate` (per-asset),
`publicSupply` (открытый `/api/wallet/supply/:assetId`).

### 7.2 Кошельки

- `PERSONAL` — один на пару `(user, state, asset)`.
- `TREASURY` — один на узел Вертикали. Режимы видимости:
  `public` / `council` / `sovereign` (см.
  `TreasuryTransparency`).
- Внутренний адрес `krwn1…` всегда есть. Для ON_CHAIN /
  HYBRID дополнительно привязывается `externalAddress`.

### 7.3 Транзакции

`TransactionKind`: `transfer` · `treasury_allocation` · `mint` · `burn`.
Каждый `transfer` по INTERNAL/HYBRID активу проходит через
**единую БД-транзакцию**, внутри которой:

1. Списываем с источника.
2. Зачисляем получателю.
3. Если `StateAsset.taxRate > 0` или
   `StateSettings.transactionTaxRate > 0` — в ту же
   транзакцию добавляем atомарный перевод в Казну корневого
   узла (root-node Treasury).

Для ON_CHAIN активов шаги 2–3 заменяются на построение
unsigned intent → клиент подписывает → Treasury Watcher
переводит `externalStatus`: `pending → confirmed / failed / dropped`.

### 7.4 Krwn Exchange Engine

Направленные пары (`fromAsset → toAsset`). Обратное
направление — отдельный объект, который другая сторона может
отказаться создавать. Это — встроенная «торговая
дипломатия»: полный обмен, одностороннее окно, санкция,
закрытие обеих границ.

---

## 8. Парламент (`core.governance`)

Три режима, которые Суверен выбирает на уровне StateSettings:

| Режим | Что делает голосование | Кто применяет результат |
|-------|------------------------|-------------------------|
| `decree` | Только информация — «жалобная книга». | Никто. Суверен всё решает сам. |
| `consultation` | Голосование проходит, но результат не применяется автоматически. | Суверен вручную жмёт `/execute` или `/veto`. |
| `auto_dao` | Успешные предложения применяются Executor-ом через `StateConfigService.update()`. | Автоматически. Суверен может наложить вето, если не выключил его сам. |

Параметры голосования (все — snapshot на момент создания
предложения, чтобы смена правил не переписывала историю):

- `quorumBps` / `thresholdBps` — в basis points, чтобы не
  теряться в плавающей точке.
- `weightStrategy` — `one_person_one_vote` · `by_node_weight` ·
  `by_balance`.
- `allowedConfigKeys` — whitelist полей StateSettings,
  которые DAO вообще имеет право трогать.

Proposal → Vote[] → ProposalStatus переходит по одной из
семи ветвей: `active → passed / rejected / expired → executed / vetoed`
(либо `cancelled`, если автор забрал до закрытия).

Подробнее: см. `src/core/governance-rules.ts`.

---

## 9. Наследие и границы (что НЕ делаем в MVP)

- Нет единого «глобального каталога» государств. Каждый инстанс
  — Sovereign Node, про которого соседи знают только по явному
  ExchangePair (Phase 5+ может добавить discovery-протокол).
- Нет embedded-DEX для крипто-активов. ON_CHAIN / HYBRID
  используют внешние DEX / банки; KrwnOS — это ledger + gate,
  а не биржа.
- Нет ролей вне Вертикали. Всё — через узлы и `Membership`.
- Нет межсерверного SSO «пользователя X в государстве A и
  государстве B». Одна учётка = одно состояние (Phase 5+:
  federated identity через passkey-синхронизацию).
- `Float` для балансов вместо `Decimal` — сознательный долг
  v0.1. На продакшене с большими оборотами следует
  переключиться на Decimal или integer-minor-units.

Полный список — в `docs/ARCHITECTURE.md` §6.

---

## 10. Roadmap

### ✅ Phase 1 — Foundation
Next.js + Tailwind · kernel types · Permissions Engine ·
Registry · Event Bus · Prisma schema · Auth adapter.

### ✅ Phase 2 — Vertical Management
CRUD узлов с проверкой прав · Membership · Lobby-узел
(Прихожая).

### ✅ Phase 3 — Module System
Bootstrap в `modules/index.ts` · `core.chat` (каналы +
директивы + ack) · динамический Widget Shell.

### ✅ Phase 4 — Sovereign Node
Три tier-а установки · Krwn CLI · Magic-link приглашения ·
Credentials Registry · Tunneling · BackupService · Schema-
per-module изоляция.

### ✅ Phase 4.5 — Economy + Governance (v0.1)
Currency Factory (INTERNAL / ON_CHAIN / HYBRID) · кошельки
и казначейства · автоматический налог в корневую Казну ·
Krwn Exchange Engine (межгосударственная торговля с
направленными парами и «санкциями») · Палата Указов
(StateSettings) · Core Governance (`decree` / `consultation` /
`auto_dao` с вето Суверена).

### ⏳ Phase 5 — Scaling
Модуль отчётности · модуль Changelog («Указы / Обновления
государства») · Redis-backed Event Bus + WebSocket gateway
(realtime во всех модулях) · Cloud marketplace images
(DigitalOcean / Linode / AWS one-click) · Treasury Watcher
cron для ON_CHAIN активов · Decimal-migration для балансов ·
Federated identity · Discovery-протокол между State-ами.

---

## 11. Дисциплина для контрибьюторов и ИИ-агентов

> «Весь код должен быть модульным. Логика иерархии и прав
> доступа — это сердце системы. Избегай жёсткого кодирования
> функций. Используй Registry для подключения новых
> возможностей. Все UI компоненты поддерживают динамическую
> смену ролей.»

- `core/*` не импортирует `modules/*`.
- Никаких `if (user.role === "admin")` — только
  `permissionsEngine.can(...)`.
- Новый функционал = новый модуль или новая публичная
  функция ядра, не ad-hoc код в `/app`.
- Каждый модуль декларирует все свои `PermissionKey` в
  `init()`.
- Всё, что касается денег — в одной БД-транзакции.
  Налоги, комиссии, mint/burn — атомарно.
- Миграции Prisma — всегда forward-only, названия снабжать
  timestamp-ом и доменом (`20260419210000_state_settings`).

---

## 12. Точки входа в репозиторий

| Если вы хотите… | Откройте |
|-----------------|----------|
| Понять архитектуру и зависимости | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Поднять локально / на VPS / в облаке | [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Первичный bootstrap (коронация Суверена) | [`docs/SETUP.md`](./SETUP.md) |
| Написать свой плагин | [`docs/MODULE_GUIDE.md`](./MODULE_GUIDE.md) |
| Понять схему БД | [`docs/DATABASE.md`](./DATABASE.md) + `prisma/schema.prisma` |
| Посмотреть команды CLI | [`docs/CLI.md`](./CLI.md) |
| Настроить приглашения и passkey | [`docs/INVITATIONS.md`](./INVITATIONS.md) |
| Публично открыть инстанс без IP | [`docs/TUNNELING.md`](./TUNNELING.md) |
| Понять изоляцию данных | [`docs/ISOLATION.md`](./ISOLATION.md) |
| Опубликовать get.krwnos.com | [`docs/HOSTING_20I.md`](./HOSTING_20I.md) |

Ядро — в `src/core/index.ts` (единая public-surface).
Модели — в `prisma/schema.prisma`.
Модули — в `src/modules/{chat,wallet,governance}/index.ts`.
Сборка CLI — в `cli/bin/krwn.mjs`.

---

## 13. Финальная формулировка

KrwnOS — это попытка дать **одному человеку** право и
возможность создать цифровую юрисдикцию, в которой:

- Иерархия — не JSON в Notion, а граф с наследуемыми правами.
- Деньги — не картинка, а ledger с налогами, казной и
  (опционально) мостом на цепь.
- Закон — не README, а типизированный `StateSettings` с
  Палатой Указов и Парламентом, у которого есть явный режим.
- Граница — не pay-wall, а `Invitation.tokenHash` и
  passkey-challenge.
- Суверенитет — не маркетинг, а `docker compose up` на вашем
  железе.

Один инстанс = одно государство. Код открыт. Данные — ваши.

---

## License

[MIT](../LICENSE) © 2026 KrwnOS contributors.
