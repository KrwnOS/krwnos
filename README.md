# KrwnOS — Community Operating System

> Модульная операционная система для создания и управления цифровыми
> государствами, компаниями, кланами и сообществами. Владелец —
> «Суверен» — конструирует уникальную Вертикаль власти, подключая
> функциональные модули.

---

## 1. Четыре кита


| Кит              | Что это                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| **The State**    | Изолированный инстанс со своим владельцем, правилами и набором модулей. |
| **The Vertical** | Графовая иерархия ролей и полномочий. Права наследуются сверху вниз.    |
| **The Kernel**   | Auth · Permissions · Event Bus · Module Registry.                       |
| **The Modules**  | Плагины: чат, казначейство, задачи, голосования, отчёты.                |


Подробнее: `[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)`.

---

## 2. Стек

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript (strict + noUncheckedIndexedAccess)
- **Database:** PostgreSQL 15+ (Prisma ORM)
- **Realtime / Event Bus:** Redis (ioredis)
- **Styling:** Tailwind CSS + shadcn-style UI primitives
- **Pattern:** Hexagonal / Modular Monolith

---

## 3. Структура репозитория

```
/src
  /app           # Next.js App Router (routes, layouts)
  /core          # Ядро: auth, permissions-engine, event-bus, registry
  /modules       # Плагины (подключаются через /src/modules/index.ts)
  /components
    /ui          # Базовые UI-примитивы (Button, Card, …)
  /lib           # prisma, redis, утилиты
  /types         # Глобальные типы: kernel.ts (State, Node, Permission, Module)
/prisma          # schema.prisma + миграции
/docs            # ARCHITECTURE.md · DATABASE.md · MODULE_GUIDE.md
```

**Правило зависимостей:** `core` ничего не знает о `modules`. Модули
подключаются в `src/modules/index.ts` через `registry.register()`.

---

## 4. Sovereign Node — три уровня установки

KrwnOS спроектирован как «Sovereign Node»: одно государство = один
инстанс, которым вы полностью владеете.


| Tier                    | Кому                               | Как                                                      |
| ----------------------- | ---------------------------------- | -------------------------------------------------------- |
| **Sandbox** (локально)  | Тесты, кланы в одной сети          | Krwn Desktop (Electron + Docker) или `docker compose up` |
| **Pro** (свой VPS)      | Энтузиасты, продвинутые сообщества | `curl -sSL https://get.krwnos.com | bash`                |
| **Cloud** (marketplace) | Кто хочет URL за минуту            | DigitalOcean / Linode / AWS one-click                    |


Подробнее: `[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)`.

### Быстрый dev-старт

```bash
npm install
cp .env.example .env            # настройте DATABASE_URL, REDIS_URL, AUTH_SECRET
npm run prisma:migrate
npm run dev
```

Или через compose (рекомендуется для Pro tier):

```bash
cd deploy
cp .env.example .env                           # выставьте AUTH_SECRET!
docker compose up -d
docker compose exec app npx prisma migrate deploy

# Первичная инициализация: создаём Суверена и корневой узел вертикали.
docker compose exec app npm run setup
```

Или локально, без контейнеров:

```bash
npm run setup                                      # интерактивный bootstrap
npm run setup -- --state "Crown Republic" \
                 --handle redmaster --yes --json   # неинтерактивный (CI)
```

Или через web-wizard:

```
http://localhost:3000/setup
```

Открыть: [http://localhost:3000](http://localhost:3000). Подробнее: `[docs/SETUP.md](./docs/SETUP.md)`.

---

## 5. Скрипты


| Команда                  | Что делает                                          |
| ------------------------ | --------------------------------------------------- |
| `npm run dev`            | Next.js dev-сервер                                  |
| `npm run build`          | Production-сборка                                   |
| `npm run typecheck`      | `tsc --noEmit` с strict-режимом                     |
| `npm run lint`           | ESLint (Next.js config)                             |
| `npm run prisma:migrate` | Прогнать миграции в dev-БД                          |
| `npm run prisma:studio`  | Открыть Prisma Studio                               |
| `npm run setup`          | **Первичный bootstrap** — создать Суверена и State  |
| `npm run compose:up`     | `docker compose -f deploy/docker-compose.yml up -d` |
| `npm run compose:down`   | Остановить production-стек                          |
| `npm run compose:logs`   | `docker compose logs -f app`                        |


---

## 5.1 Krwn CLI — пульт управления государством

```bash
npm link -w cli                                    # локальная разработка
# либо:  npm i -g @krwnos/cli  (после публикации)

krwn login --host https://myclan.krwnos.app --token kt_xxx
krwn module install finance
krwn vertical add "Ministry of Defense" --type department
krwn invite --node ver_recruit --ttl 7d --max-uses 25
krwn backup --out ./state.json
krwn token rotate --label "daily-ops"
krwn status
```

Полный референс: `[docs/CLI.md](./docs/CLI.md)`.
Как пользователи попадают внутрь (magic links + passkeys/wallets):
`[docs/INVITATIONS.md](./docs/INVITATIONS.md)`.

---

## 6. Roadmap (MVP)

### Phase 1 — Foundation ✅ (текущая)

- Next.js 14+ App Router + Tailwind
- Типовая модель ядра (`types/kernel.ts`)
- Permissions Engine (наследование по Вертикали)
- Module Registry + Event Bus
- Prisma-схема (`State`, `VerticalNode`, `Membership`, `InstalledModule`)
- Auth adapter (NextAuth → `setAuthAdapter()`)

### Phase 2 — Vertical Management

- Drag-and-drop редактор иерархии
- Server actions / API для CRUD узлов с проверкой прав
- UI-назначение `Membership`

### Phase 3 — Module System

- Бутстрап модулей в `src/modules/index.ts`
- Первый модуль: `core.chat` (базовая коммуникация внутри вертикали)
- Dynamic Desktop (Widget Shell)

### Phase 4 — Sovereign Node

- Три tier-а установки: Sandbox / Pro / Cloud (concept + install scripts + compose)
- Krwn CLI (login / module / vertical / invite / backup / status)
- Magic-link invitations с SHA-256-hashing и QR-кодами
- Passwordless credential registry (passkey / wallet / oauth / magic email)
- Tunneling adapter (cloudflared / frp / ngrok / tailscale funnel)
- Data isolation: schema-per-module
- Backup engine (versioned snapshot JSON)

### Phase 5 — Scaling

- Модуль отчётности для инвесторов
- Модуль Changelog («Указы» / «Обновления государства»)
- Redis-backed Event Bus + WebSocket gateway
- Cloud marketplace images (DigitalOcean / Linode / AWS)

---

## 7. Дисциплина для ИИ-агентов и контрибьюторов

> «Весь код должен быть модульным. Логика иерархии и прав доступа —
> это сердце системы. Избегай жёсткого кодирования функций.
> Используй Registry для подключения новых возможностей. Все UI
> компоненты поддерживают динамическую смену ролей.»

- `core/*` не импортирует из `modules/*`.
- Никаких `if (user.role === "admin")` — только `permissionsEngine.can(...)`.
- Новый функционал = новый модуль или новая публичная функция ядра,
но не ad-hoc код в `/app`.
- Каждый модуль декларирует свои `PermissionKey` в `init()`.

---

## 8. Документация

- `[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)` — ядро, Vertical, модули, правила зависимостей.
- `[docs/DATABASE.md](./docs/DATABASE.md)` — схема БД и типовые запросы.
- `[docs/MODULE_GUIDE.md](./docs/MODULE_GUIDE.md)` — как написать плагин.
- `[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)` — три уровня установки (Sandbox / Pro / Cloud).
- `[docs/SETUP.md](./docs/SETUP.md)` — первичная коронация Суверена (web / CLI / CI).
- `[docs/CLI.md](./docs/CLI.md)` — команды `krwn` CLI.
- `[docs/INVITATIONS.md](./docs/INVITATIONS.md)` — magic links, QR-паспорта, passkeys.
- `[docs/TUNNELING.md](./docs/TUNNELING.md)` — публичная доступность без проброса портов.
- `[docs/ISOLATION.md](./docs/ISOLATION.md)` — изоляция данных между State и модулями.
- `[docs/HOSTING_20I.md](./docs/HOSTING_20I.md)` — публикация `krwnos.com` и `get.krwnos.com` на shared-хостинге.

---

## License

[MIT](./LICENSE) © 2026 KrwnOS contributors.