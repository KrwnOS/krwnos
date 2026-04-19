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
