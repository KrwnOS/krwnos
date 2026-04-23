# KrwnOS — Database Schema

**Stack:** PostgreSQL 15+ · Prisma ORM · (Redis для pub/sub и кэша).

Файл схемы: [`prisma/schema.prisma`](../prisma/schema.prisma).

---

## 1. ER-диаграмма (высокоуровневая)

```
                 ┌──────────┐
                 │  User    │
                 └────┬─────┘
                      │ 1
                      │
        ┌─────────────┼──────────────┐
        │ N           │ N            │ N
        ▼             ▼              ▼
  ┌──────────┐  ┌───────────┐  ┌────────────────┐
  │  State   │  │ Membership│  │ (other)        │
  │ (owner)  │  └─────┬─────┘  └────────────────┘
  └────┬─────┘        │ N
       │ 1            │
       │              ▼
       │        ┌──────────────┐
       │   1:N  │ VerticalNode │◄──┐  self-reference
       └───────►│              │   │  (parentId → id)
                └──────┬───────┘   │
                       └───────────┘
       │ 1
       ▼
  ┌──────────────────┐
  │ InstalledModule  │
  └──────────────────┘
```

---

## 2. Таблицы

### `User`
Идентичность внутри KrwnOS. Ключевое: `handle` уникален глобально,
`email` — тоже. Один пользователь может владеть многими State
(`ownedStates`) и состоять в многих узлах через `Membership`.

Поля **email digest** (BullMQ `email-digest-daily` / `email-digest-weekly`):
`emailDigestDaily`, `emailDigestWeekly`, `emailDigestChatMentions`
(опциональная подсекция «упоминания в чате» по подстроке `@handle`).
Включение дайджестов на инстансе — env `KRWN_EMAIL_DIGEST_ENABLED`
(см. `docs/DEPLOYMENT.md`). Персистентное «письмо одно за период» —
`EmailDigestSend`.

### `AuthCredential` / `TelegramLinkToken`
Беспарольные учётные данные: `kind` в enum включает `telegram` — в
`identifier` хранится числовой id пользователя Telegram (строка). Уникальность
`@@unique([kind, identifier])` не даёт привязать один Telegram к двум
аккаунтам KrwnOS.

`TelegramLinkToken` — одноразовые хеши ссылок привязки (выдаются
`TelegramCredentialProvider.beginEnrollment`), срок `expiresAt`, после успеха
`consumedAt`. См. `docs/DEPLOYMENT.md`, `POST /api/telegram/link/start`.

### `State` — Государство
| Поле | Тип | Заметки |
|------|-----|---------|
| `id` | cuid | PK |
| `slug` | string unique | адрес государства: `/s/{slug}` |
| `ownerId` | FK → User | Суверен (cascade delete owner → state) |
| `config` | JSONB | `{ theme, installedModules[], flags }` |

`installedModules` дублируется в отдельной таблице `InstalledModule`
для per-plugin конфига и аудита. Поле в `config.installedModules`
денормализовано для быстрого чтения в UI shell.

### `VerticalNode` — Узел власти
Самоссылочная таблица (`parentId` → `id`).

| Поле | Тип | Заметки |
|------|-----|---------|
| `stateId` | FK → State | cascade |
| `parentId` | FK → VerticalNode nullable | `SetNull` при удалении родителя (нода становится корневой, UI подсказывает переназначить) |
| `type` | enum | `position` / `department` / `rank` |
| `permissions` | string[] | канонические ключи вроде `finance.read` |
| `order` | int | для drag-and-drop |

**Индексы:** `(stateId)`, `(parentId)`, `(stateId, parentId)` —
последний ускоряет построение дерева одним запросом:
`SELECT ... WHERE stateId = $1 ORDER BY parentId NULLS FIRST, order`.

**Инвариант (приложения):** граф ацикличен и связен в рамках одного
`stateId`. Никаких FK cross-state.

### `Membership`
Связь много-ко-многим User ↔ VerticalNode.

- `@@unique([userId, nodeId])` — пользователь не может быть в одном
  узле дважды.
- `title` — опциональный персональный титул («Первый Министр»,
  «Рядовой»).

### `StateUserBan`
Блокировка пользователя в рамках одного `State` (повторный вход и
открытая регистрация отклоняются, пока `revokedAt IS NULL`).

| Поле | Заметки |
|------|---------|
| `stateId`, `userId` | `@@unique([stateId, userId])` |
| `reason` | Опционально; для аудита |
| `createdById` | Кто выставил бан (nullable, без FK) |
| `revokedAt` | Разбан: не `null` → запись остаётся, но бан не активен |

См. `src/server/citizens-admin-service.ts`, `src/server/state-ban.ts`.

### `NodeSubscription` / `NodeSubscriptionPeriodCharge`

Подписка узла: фиксированный перевод из **казны дочернего** `VerticalNode`
в **казну родителя** (`parentId` дочернего должен совпадать с
`parentNodeId`). Расписание: `MONTHLY` (ключ периода UTC `YYYY-MM`) или
`WEEKLY` (ключ — дата понедельника ISO-недели UTC `YYYY-MM-DD`).
Идемпотентность списаний: `@@unique([nodeSubscriptionId, periodKey])` на
`NodeSubscriptionPeriodCharge` (аналогично `RoleTaxPeriodCharge`).
Фон: BullMQ `node-subscription-tick` (`src/modules/wallet/node-subscription-tick.ts`).

### `WalletFine`

Штраф с **личного** кошелька в казну узла: по **указу** Суверена
(`POST /api/wallet/fine`, `source = decree`) или после исполнения
предложения Парламента с `targetConfigKey = walletFine` (`source =
governance`). Уникальность исполнения по голосованию: `proposalId`
nullable `@unique`. Налог на перевод (state + asset) применяется как при
обычном `transfer` (см. `src/modules/wallet/wallet-fine.ts`).

### `InstalledModule`
Per-State установка плагина с собственным `config` JSONB.

- `@@unique([stateId, slug])`.
- Удаление State каскадно удаляет записи.

### `StateSettings`
Палата Указов (1:1 с `State`). Помимо фискальных и governance-полей:

| Поле | Заметки |
|------|---------|
| `uiLocale` | Nullable `TEXT`. Код интерфейса по умолчанию для инстанса (`en`, `ru`, `es`, `zh`, `tr`). Персональный cookie `krwnos_locale` на устройстве по-прежнему может переопределить при SSR. |
| `extras.trustedModulePublishers` | JSONB. Массив `{ id: string, pubKeyPem: string }` — доверенные издатели подписанных `.krwn`. Верификация сопоставляет `publicKeyFingerprint` из `SIGNATURE` пакета c SHA-256-отпечатком ключей в этом списке (см. `docs/MODULE_GUIDE.md` — «Подпись и распространение модулей»). Управляется permission-ключом `modules.trust.manage` (sovereignOnly), регистрируется в `registerCorePermissions()`. |

См. `prisma/schema.prisma`, `src/core/state-config.ts`, `/admin/constitution`.

### `ActivityLog`
Агрегированная лента (Пульс / аудит): одна строка на заметное событие модулей.

| Поле | Заметки |
|------|---------|
| `visibility` | `public` / `node` / `audience` / `sovereign` — кто видит строку в обычной ленте. |
| `createdAt` | Индекс `(stateId, createdAt)` для хвостовых запросов. |

**Ретенция:** переменная окружения `KRWN_ACTIVITY_LOG_RETENTION_DAYS` (по умолчанию `365`; `0` — не ограничивать и не удалять фоном). API `/api/activity` и `ActivityFeedService.listForViewer` отсекают строки старше порога; фоновая задача BullMQ `activity-log-reaper` удаляет просроченные строки из БД (см. `src/jobs/worker.ts`, `.env.example`).

**Полный журнал аудита:** `GET /api/activity?audit=1` — только Суверен или эффективный `system.admin`; снимает фильтр видимости, но ретенция по дате остаётся.

### `WebPushSubscription`
PWA Web Push: одна строка на пару (`userId`, `endpoint` push-сервиса) в
рамках `stateId`.

| Поле | Заметки |
|------|---------|
| `endpoint` | URL endpoint (дублируется из JSON для `@@unique([userId, endpoint])`). |
| `subscription` | JSON `PushSubscription` из браузера (`endpoint` + `keys`). |
| `notifyDirectiveAcks` | Уведомлять автора директивы о «Принято к исполнению». |
| `notifyProposalVotes` | Уведомлять автора предложения о новых голосах. |

Каскад при удалении `User` / `State`. См. `src/lib/web-push-delivery.ts`,
`POST /api/push/subscribe`.

### `EmailDigestSend`
Идемпотентность email-дайджестов: уникальный ключ `(userId, kind, periodKey)`
(`kind`: `daily` | `weekly`; `periodKey` — см. `src/jobs/email-digest-period.ts`).
Запись создаётся сразу перед SMTP-отправкой; при ошибке SMTP строка
удаляется, чтобы следующий cron мог повторить.

---

## 3. Типовые запросы

### Построить дерево Вертикали одним запросом
```ts
const nodes = await prisma.verticalNode.findMany({
  where: { stateId },
  orderBy: [{ parentId: "asc" }, { order: "asc" }],
});
```
Далее `indexById(nodes)` → `VerticalSnapshot` для `PermissionsEngine`.

### Все права пользователя в State
```ts
const memberships = await prisma.membership.findMany({
  where: { userId, node: { stateId } },
  select: { nodeId: true },
});
// + snapshot + permissionsEngine.resolveAll(...)
```

---

## 4. Миграции

```bash
# Development
npx prisma migrate dev --name <description>

# Production
npx prisma migrate deploy
```

См. [Prisma migration best practices](https://www.prisma.io/docs/guides/migrate/production-troubleshooting).

---

## 5. Redis (вне PostgreSQL)

- **Pub/Sub:** канал `krwnos:events:<stateId>` для доставки
  `ModuleEventBus` в other processes и WebSocket-gateway.
- **Cache:** ключи `perms:<stateId>:<userId>` с TTL 60 s — мемоизация
  `permissionsEngine.resolveAll()`. Инвалидация на событиях
  `kernel.node.*` / `kernel.membership.*`.
