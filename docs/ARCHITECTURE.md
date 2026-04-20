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

---

## 7. CSRF и non-idempotent App Router API

Классический CSRF актуален там, где браузер **сам** прикрепляет сессию
(cookie) к запросу без явного секрета в теле. У KrwnOS почти все
изменяющие маршруты аутентифицируются через **`Authorization: Bearer`**
(CLI-токен в `authenticateCli` / `loadWalletContext` и т.д.). Такой
заголовок сторонний сайт подставить не может (в отличие от cookies), поэтому
**double-submit cookie и отдельный CSRF-токен для Bearer-маршрутов не
требуются**.

Исключения — **публичные** `POST` без Bearer (`/api/register`, первичный
`POST /api/setup`, `POST /api/invite/:token/accept` с сессией через
`getAuth()`). Для них применяется **`rejectIfCrossSiteMutation`** в
`src/lib/same-origin-mutation.ts`: сверка `Origin` / `Referer` с
`req.nextUrl.origin`, плюс эвристика по `Sec-Fetch-Site`; при
`Authorization: Bearer` проверка пропускается (CLI/скрипты задают Origin
явно или используют Bearer). См. unit-тесты в
`src/lib/__tests__/same-origin-mutation.test.ts`.

### Инвентаризация `POST` / `PATCH` / `DELETE` (`src/app/api/**`)

| Метод | Путь | Защита CSRF (кратко) |
|-------|------|----------------------|
| POST | `activity/broadcast` | Bearer CLI — см. §7 |
| POST | `admin/vertical` | Bearer CLI |
| PATCH | `admin/vertical/[nodeId]` | Bearer CLI |
| DELETE | `admin/vertical/[nodeId]` | Bearer CLI |
| POST | `chat/channels` | Bearer CLI |
| POST | `chat/channels/[channelId]/messages` | Bearer CLI |
| POST | `chat/channels/[channelId]/directives` | Bearer CLI |
| POST | `chat/messages/[messageId]/ack` | Bearer CLI |
| GET | `chat/stream` | Идемпотентно; токен в query (см. `cli/auth.ts`) |
| POST | `cli/backup` | Bearer CLI |
| POST | `cli/invite` | Bearer CLI |
| POST | `cli/modules` | Bearer CLI |
| POST | `cli/tokens/rotate` | Bearer CLI |
| POST | `cli/vertical` | Bearer CLI |
| POST | `governance/proposals` | Bearer CLI |
| GET | `governance/proposals/[proposalId]` | Идемпотентно |
| DELETE | `governance/proposals/[proposalId]` | Bearer CLI |
| POST | `governance/proposals/[proposalId]/execute` | Bearer CLI |
| POST | `governance/proposals/[proposalId]/vote` | Bearer CLI |
| POST | `governance/proposals/[proposalId]/veto` | Bearer CLI |
| POST | `invite/[token]/accept` | Same-origin helper + rate limit |
| POST | `register` | Same-origin helper + rate limit |
| POST | `register/admit` | Bearer CLI |
| POST | `setup` | Same-origin helper + rate limit |
| PATCH | `state/constitution` | Bearer CLI |
| PATCH | `state/theme` | Bearer CLI |
| POST | `wallet/assets` | Bearer CLI |
| GET | `wallet/assets/[assetId]` | Идемпотентно |
| PATCH | `wallet/assets/[assetId]` | Bearer CLI |
| DELETE | `wallet/assets/[assetId]` | Bearer CLI |
| POST | `wallet/assets/[assetId]/primary` | Bearer CLI |
| POST | `wallet/mint` | Bearer CLI |
| POST | `wallet/treasuries` | Bearer CLI |
| GET | `wallet/treasuries/[nodeId]` | Идемпотентно |
| POST | `wallet/transfer` | Bearer CLI |
| POST | `wallet/transfer/confirm` | Bearer CLI |
| POST | `wallet/transfer/intent` | Bearer CLI |

---

## 8. PWA и офлайн-кэш Pulse

Установляемое приложение (`public/manifest.webmanifest`, иконки в
`public/icons/`) и service worker (`public/sw.js`) регистрируются из
`ServiceWorkerRegister` **только в production**, чтобы не конфликтовать с
HMR в dev.

**`GET /api/state/pulse`** — персональный контекст (Bearer CLI-токен). Его
нельзя кэшировать «по URL одному на всех»: Cache API ключует запросы без
учёта заголовков по умолчанию. SW поэтому:

- кладёт успешный ответ в `caches` под **синтетическим ключом**
  `GET /__krwn_sw/pulse/<SHA-256(Authorization)>`;
- при офлайне отдаёт последний успешный снимок для **того же** токена и
  помечает ответ заголовком `X-Krwn-Pulse-Cache: offline`, чтобы UI мог
  показать предупреждение.

Кэширование **не** применяется, если нет заголовка `Authorization: Bearer
…` (например, тестовый запрос без токена). Лента активности и SSE/WS без
сети по-прежнему недоступны — MVP охватывает только снимок Pulse + статику
`/_next/static/*`.

**Web Push:** браузер подписывается через `pushManager.subscribe` (ключ
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) после `ServiceWorkerRegister`; токен CLI из
`localStorage` уходит на `POST /api/push/subscribe`, строка в
`WebPushSubscription` (per `userId` + `endpoint`, поля prefs см.
`docs/DATABASE.md`). Сервер подписывает payload библиотекой `web-push`
(`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) и шлёт уведомления на события шины:
`core.chat.directive.acknowledged` (получатель — автор директивы, если prefs)
и `core.governance.proposal.vote_cast` (получатель — автор предложения).
Service worker (`public/sw.js`) обрабатывает `push` и `notificationclick`.
Маршруты подписки rate-limited (`api_push_subscribe` / `api_push_unsubscribe`).
Подробнее env: `docs/DEPLOYMENT.md`.
