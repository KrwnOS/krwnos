# KrwnOS — Deployment Tiers

KrwnOS — **Sovereign Node**: одно государство = один инстанс, который
вы полностью контролируете. Поддерживаются три уровня развёртывания —
от ноутбука до облачного marketplace.

---

## Tier 1 — Sandbox (локально)

**Кому:** небольшим кланам, командам в одной сети, тестам.
**Как:** Krwn Desktop (Electron + встроенный Docker).

```bash
# Вариант A: прямо через docker compose
git clone https://github.com/KrwnOS/krwnos.git
cd krwnos/deploy
cp .env.example .env                           # AUTH_SECRET обязателен!
docker compose up -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run setup          # коронация Суверена

# Вариант B (в будущем): Krwn Desktop .dmg/.exe/.AppImage
```

- Данные живут в локальных docker volumes (`krwn_pg`, `krwn_redis`).
- URL: `http://localhost:3000`.
- Подойдёт без доменного имени. Для приглашений в локалке работают
  ссылки вида `http://192.168.x.y:3000/invite/...`.

### OpenTelemetry (трассировка HTTP)

Сервер Next.js поднимает минимальный OTel SDK (`src/instrumentation.ts`).
В **development** по умолчанию спаны пишутся в **консоль** процесса. Если задан
endpoint OTLP (например локальный коллектор), используется экспорт **OTLP/HTTP**.
В **production** трассировка включается **только** при настройке OTLP через
переменные окружения (без захардкоженных ключей и URL в коде).

| Env | Зачем |
|-----|--------|
| `OTEL_SERVICE_NAME` | Имя сервиса в ресурсе (по умолчанию `krwnos`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Базовый URL коллектора (HTTP); для трейсов совместим с типичным OTLP HTTP. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Полный URL для трейсов, если отличается от базового (перекрывает часть путей для traces). |
| `OTEL_EXPORTER_OTLP_HEADERS` | Заголовки для OTLP (`key=value`, через запятую), например токен провайдера — **только из env**, не из репозитория. |
| `OTEL_EXPORTER_OTLP_TIMEOUT_MS` | Таймаут экспорта (мс), если поддерживается используемым экспортёром. |
| `OTEL_SDK_DISABLED` | `true` — полностью отключить SDK. |
| `OTEL_TRACES_EXPORTER` | `none` — не экспортировать трейсы (отключение на уровне спецификации). |
| `KRWN_OTEL_ENABLED` | `0` — явно выключить инициализацию KrwnOS (удобно для локальных тестов). |

Пример локального OTLP (Jaeger OTLP HTTP на `4318`):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

### Realtime: Redis Event Bus + WebSocket gateway

Когда задан `REDIS_URL`, при старте Next.js (`instrumentation.ts`) ядро
переключает `eventBus` на `RedisEventBus` — события чата и Пульса
доступны всем воркерам и отдельным процессам.

Дополнительно можно поднять **WebSocket-шлюз** (тот же Redis pub/sub):

```bash
npm run ws:gateway
```

| Env | Зачем |
|-----|--------|
| `NEXT_PUBLIC_KRWN_WS_URL` | Базовый URL для браузера, например `wss://state.example.com/ws` или `ws://127.0.0.1:3010`. Если не задан — UI остаётся на **SSE** (`/api/chat/stream`, `/api/activity/stream`). |
| `KRWN_WS_PORT` | Порт процесса `ws:gateway` (по умолчанию `3010`). |
| `KRWN_WS_HOST` | Адрес bind (по умолчанию `0.0.0.0`). |
| `KRWN_REDIS_EVENT_BUS` | `0` — не переключать ядро на Redis (только in-memory bus). |
| `KRWN_PRESENCE_REDIS` | `0` — не писать presence в Redis (только память процесса). |

За прокси (nginx / Caddy) пробросьте WebSocket на тот же хост, что и
Next.js, и выставьте `NEXT_PUBLIC_KRWN_WS_URL` на публичный `wss://…`,
чтобы CSP `connect-src` оставался предсказуемым.

### PWA (install + offline Pulse)

В production приложение регистрирует `public/sw.js` (см. `docs/ARCHITECTURE.md`
§8): установка через manifest, офлайн read-кэш последнего успешного
`GET /api/state/pulse` для текущего Bearer-токена, плюс runtime-кэш
`/_next/static/*`. Иконки: `public/icons/icon-192.png`, `icon-512.png`
(при необходимости перегенерировать: `scripts/generate-pwa-icons.ps1` в
PowerShell на Windows).

**Web Push (scaffold):** полная доставка уведомлений не реализована
(`docs/ROADMAP.md`). Для будущей интеграции задайте VAPID-пару и субъект
(только из секретов окружения, не в репозитории):

| Env | Зачем |
|-----|--------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Публичный ключ VAPID (URL-safe base64) для `pushManager.subscribe` в браузере. |
| `VAPID_PRIVATE_KEY` | Приватный ключ VAPID на сервере для подписи payload (будущий `web-push`). |
| `VAPID_SUBJECT` | Контакт для VAPID, обычно `mailto:ops@example.com` или `https://…` по спецификации. |

Заглушка `POST /api/push/subscribe` принимает JSON с полем `subscription`,
ответ `202` без сохранения в БД. Когда появится отправка push, в
`next.config.mjs` для `Content-Security-Policy` → `connect-src` может
понадобиться добавить эндпоинты провайдера (например FCM).

---

## Tier 2 — Pro (свой VPS / домашний сервер)

**Одной командой:**

### Linux / macOS
```bash
curl -sSL https://get.krwnos.com | bash
```

### Windows (PowerShell)
```powershell
iwr -useb https://get.krwnos.com/install.ps1 | iex
```

Скрипт делает:

1. Проверяет `docker`, `docker compose v2`, `git`.
2. Клонирует репо в `~/.krwnos`.
3. Генерирует `.env` c криптостойким `AUTH_SECRET`.
4. Поднимает `postgres`, `redis`, `app` через `docker-compose.yml`.
5. Применяет миграции Prisma.
6. Опционально включает **Cloudflare Tunnel** (если задан
   `KRWN_TUNNEL=<cloudflared-token>`).

**Переменные:**

| Env | Default | Зачем |
|-----|---------|-------|
| `KRWN_REPO` | `https://github.com/KrwnOS/krwnos.git` | Источник |
| `KRWN_DIR` | `~/.krwnos` | Папка установки |
| `KRWN_REF` | `main` | Ветка/тег |
| `KRWN_PORT` | `3000` | Локальный порт |
| `KRWN_TUNNEL` | `""` | Cloudflared tunnel token |

См. также [`TUNNELING.md`](./TUNNELING.md).

---

## Tier 3 — Cloud Marketplace (под ключ)

**Кому:** тем, кто хочет URL вида `myclan.krwnos.app` за минуту без
ssh и docker.

План:

| Provider | Образ | Кнопка |
|----------|-------|--------|
| DigitalOcean | Marketplace Droplet | «Install KrwnOS» |
| Linode | StackScript | «Deploy KrwnOS» |
| AWS | AMI + CloudFormation | «Launch Stack» |
| Railway / Render | Blueprint (`railway.json`) | «Deploy Template» |

Образ включает:
- Preinstalled docker-compose стек.
- systemd unit `krwnos.service`.
- Auto-provisioned Cloudflare Tunnel + auto-DNS под `*.krwnos.app`.
- Initial bootstrap wizard на `/setup` для создания Суверена.

Пользователь нажимает кнопку → через 60 секунд получает готовый URL и
одноразовый код для первого логина.

---

## Сравнение

| Признак | Sandbox | Pro | Cloud |
|---------|---------|-----|-------|
| Установка | 1 клик (Desktop) | 1 команда (curl) | 1 клик (web) |
| DNS / домен | нет | ваш / tunnel | `*.krwnos.app` |
| Контроль данных | полный (локально) | полный (ваш VPS) | полный (ваш cloud account) |
| Публичный доступ | только LAN | через tunnel/VPS | из коробки |
| Апгрейды | ручные | `krwn upgrade` | авто |
| Стоимость | бесплатно | цена VPS | цена инстанса |
