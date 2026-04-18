# `/deploy` — production stack для KrwnOS

Канонический путь поднять KrwnOS на своём сервере (Pro tier).

## Структура

```
deploy/
├─ docker-compose.yml   # postgres + redis + app + (optional) cloudflared
├─ .env.example         # → скопируйте в .env и пропишите секреты
└─ README.md            # этот файл
```

## Быстрый старт

```bash
cd deploy
cp .env.example .env
# ⚠️  Обязательно замените AUTH_SECRET:
#     openssl rand -hex 32

docker compose up -d
docker compose exec app npx prisma migrate deploy

# Первая инициализация: создаём Суверена и корневой узел вертикали.
docker compose exec app npm run setup
```

После этого откройте `http://localhost:3000`.

## С туннелем (публичный URL без проброса портов)

```bash
# В deploy/.env задайте токен:
#   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
docker compose --profile tunnel up -d
```

Подробнее: [../docs/TUNNELING.md](../docs/TUNNELING.md).

## Переменные

Все параметры compose-стека описаны в [`.env.example`](./.env.example).
Строго обязательный — **`AUTH_SECRET`** (сервис `app` упадёт, если он
пустой — это защита от случайного dev-запуска в production).

## Зачем отдельная папка

- Чёткая граница: `/src` — приложение, `/deploy` — инфраструктура.
- `deploy/.env` не перепутать с `./.env` dev-контура (Prisma dev).
- На Tier 3 (Cloud marketplace) достаточно скопировать `/deploy` в
  образ и ничего больше.
