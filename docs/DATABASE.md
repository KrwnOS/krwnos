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

### `InstalledModule`
Per-State установка плагина с собственным `config` JSONB.

- `@@unique([stateId, slug])`.
- Удаление State каскадно удаляет записи.

### `ActivityLog`
Агрегированная лента (Пульс / аудит): одна строка на заметное событие модулей.

| Поле | Заметки |
|------|---------|
| `visibility` | `public` / `node` / `audience` / `sovereign` — кто видит строку в обычной ленте. |
| `createdAt` | Индекс `(stateId, createdAt)` для хвостовых запросов. |

**Ретенция:** переменная окружения `KRWN_ACTIVITY_LOG_RETENTION_DAYS` (по умолчанию `365`; `0` — не ограничивать и не удалять фоном). API `/api/activity` и `ActivityFeedService.listForViewer` отсекают строки старше порога; фоновая задача BullMQ `activity-log-reaper` удаляет просроченные строки из БД (см. `src/jobs/worker.ts`, `.env.example`).

**Полный журнал аудита:** `GET /api/activity?audit=1` — только Суверен или эффективный `system.admin`; снимает фильтр видимости, но ретенция по дате остаётся.

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
