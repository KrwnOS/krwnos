# KrwnOS — Architecture

> Модульная операционная система для создания цифровых государств.
> Ядро ничего не знает о плагинах; плагины общаются с миром только
> через формальные контракты ядра.

---

## 1. Архитектурный стиль

**Hexagonal / Modular Monolith.**

```
┌────────────────────────────────────────────────────────────┐
│                        Next.js App                         │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────┐    │
│  │  /app      │   │  /components │   │  /modules/*    │    │
│  │ (routes)   │   │  (UI shell)  │   │  (plugins)     │    │
│  └─────┬──────┘   └──────┬───────┘   └────────┬───────┘    │
│        │                 │                    │            │
│        ▼                 ▼                    ▼            │
│  ┌────────────────────────────────────────────────────┐    │
│  │                      /src/core                     │    │
│  │  Auth │ Permissions │ Event Bus │ Module Registry  │    │
│  └──────────────────────┬─────────────────────────────┘    │
│                         ▼                                  │
│            ┌────────────────────────┐                      │
│            │  /src/lib (prisma/redis)│                     │
│            └────────────────────────┘                      │
└────────────────────────────────────────────────────────────┘
```

**Правила зависимостей (MUST):**

- `core/*` зависит только от `types/*` и `lib/*`.
- `modules/*` зависит только от `types/*` и публичных экспортов `core`.
- `core` никогда не импортирует из `modules/*`. Связывание происходит
  через `registry.register()` в `modules/index.ts`.
- UI компоненты (`components/*`) чистые и не знают о Prisma / Redis.

---

## 2. Четыре кита системы

| Кит | Сущность | Ответственность |
|-----|----------|-----------------|
| **The State** | `State` | Пространство-инстанс: тема, список установленных модулей, владелец. |
| **The Vertical** | `VerticalNode` | Графовая иерархия позиций/отделов/рангов. Полномочия наследуются сверху вниз. |
| **The Kernel** | `core/*` | Auth · Permissions · Event Bus · Registry. |
| **The Modules** | `modules/*` | Плагины: чат, казначейство, задачи, голосования, отчёты. |

---

## 3. Ядро (Kernel)

### 3.1 Auth (`core/auth.ts`)
Абстракция над провайдером идентификации. Реальный адаптер (NextAuth /
Clerk / custom) регистрируется через `setAuthAdapter()` на старте.
Возвращает `UserRef` — минимальный профиль пользователя, который можно
передать в модули без утечки внутренних полей БД.

### 3.2 Permissions Engine (`core/permissions-engine.ts`)
Главный алгоритм наследования прав.

```
walkUp(startNode):
  chain = []
  node = startNode
  while node != null and node not in visited:
    visited.add(node)
    chain.push(node)
    node = parentOf(node)
  return chain

can(user, permission):
  if user is Sovereign of State → return true
  for each node in membershipsOf(user):
    for each ancestor in walkUp(node):
      if ancestor.permissions contains permission or "<domain>.*" or "*":
        return true
  return false
```

Дополнительно `resolveAll()` возвращает полный множество прав —
`ModuleContext.permissions` собирается один раз на запрос и передаётся
всем вызовам модулей.

### 3.3 Event Bus (`core/event-bus.ts`)
Асинхронная шина событий между модулями.

- `InMemoryEventBus` — in-process, дефолт.
- `RedisEventBus` — опциональная production-реализация поверх ioredis.
- Канонические ядерные события в `KernelEvents` (state.created,
  node.moved, module.installed, ...). Плагины публикуют свои
  `"<slug>.<action>"` (например, `treasury.transaction.created`).

### 3.4 Module Registry (`core/registry.ts`)
Единственный источник истины по установленным плагинам и заявленным
правам. Модуль обязан задекларировать **все** используемые
`PermissionKey` в `init()`. Попытка проверять незаявленное право —
ошибка ядра (в будущем: fail-closed).

---

## 4. Графовая модель власти

- `VerticalNode` имеет `parentId: string | null`. Один корень на State.
- Отношение самоссылочное 1:N — у узла ровно один родитель, много
  потомков.
- Целостность графа гарантируется на уровне приложения (нет циклов) и
  защищается `walkUp()` через `visited`-guard.
- Принадлежность пользователя к узлу хранится в `Membership`
  (много-ко-многим).

Подробнее см. [`DATABASE.md`](./DATABASE.md).

---

## 5. Динамический UI

Рабочее пространство собирается из `ModuleWidget`, возвращаемых
установленными модулями. Shell:

1. Резолвит `ModuleContext` (user, state, permissions).
2. Проходит по `registry.listForState(state.config.installedModules)`.
3. Для каждого модуля вызывает `getWidget(ctx)`.
4. Фильтрует виджеты по `requiredPermission` → раскладывает сеткой.

Министр видит финансовые дашборды; гражданин — только ленту новостей.
Единый shell, разный набор виджетов.

---

## 6. Границы, которые мы сознательно НЕ переходим (MVP)

- Межгосударственные отношения (State-to-State API) — Phase 5+.
- Экономика внутри ядра — только через модуль `treasury`.
- Кастомные роли вне Vertical — не поддерживаются by design. Вся власть
  идёт через узлы.
