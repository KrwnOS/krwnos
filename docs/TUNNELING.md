# Tunneling — публичная доступность без возни с сетью

Цель: Суверен запустил KrwnOS на домашнем ноутбуке — и уже через минуту
его государство доступно миру на красивом `myclan.krwnos.app`, без
проброса портов, без статического IP, без DynDNS.

---

## Поддерживаемые провайдеры

| Provider | Плюсы | Минусы | Default tier |
|----------|-------|--------|--------------|
| **cloudflared** | HTTPS из коробки, cname под свой домен, бесплатно | нужен аккаунт Cloudflare | Pro / Cloud |
| **tailscale funnel** | magic hostname, zero-config | требует Tailscale аккаунт | Sandbox |
| **frp** | self-hosted, без сторонних сервисов | нужен свой FRP-сервер | Advanced |
| **ngrok** | простейший dev-сценарий | ротация URL на free | Dev / debug |

Ядро знает про них только как про `TunnelAdapter`:

```ts
interface TunnelAdapter {
  readonly provider: TunnelProvider;
  start(config): Promise<{ hostname }>;
  stop(): Promise<void>;
  status(): Promise<TunnelStatus>;
}
```

Конкретные имплементации живут в `infrastructure/tunnel/*` и
подключаются в bootstrap. Ни один модуль не видит их напрямую.

---

## Cloudflared (рекомендуется для Pro tier)

В `docker-compose.yml` есть служба `cloudflared` в профиле `tunnel`:

```bash
# 1. Получите tunnel token:
#    https://one.dash.cloudflare.com/ → Networks → Tunnels → Create
export CLOUDFLARE_TUNNEL_TOKEN=eyJ...

# 2. Стартуйте с профилем tunnel:
docker compose --profile tunnel up -d
```

Cloudflare сам выдаст публичный URL и проксирует трафик на `app:3000`
внутри compose-сети. IP сервера и открытые порты не раскрываются.

---

## Автоматический DNS для Cloud tier

Для marketplace-образов (Tier 3) у нас предусмотрен zone-apex
`*.krwnos.app`, которым управляет KrwnOS-оркестратор:

```
user clicks "Deploy"
       │
       ▼
orchestrator.create_state(slug="myclan")
       │
       ├─► cloudflare dns: myclan.krwnos.app CNAME → tunnel
       ├─► droplet provisioned with image
       └─► first-boot script sets CLOUDFLARE_TUNNEL_TOKEN
       │
       ▼
   https://myclan.krwnos.app/setup   (60s later)
```

DNS-запись живёт ровно столько, сколько живёт State. При удалении —
removed in the same transaction.

---

## Health

`GET /api/cli/status` возвращает блок:

```json
{
  "tunnel": {
    "provider": "cloudflared",
    "enabled": true,
    "publicUrl": "https://myclan.krwnos.app"
  }
}
```

`TunnelManager` эмитит в Event Bus:
- `kernel.tunnel.started` — туннель поднят.
- `kernel.tunnel.degraded` — ping не прошёл.
- `kernel.tunnel.stopped` — снят.

Любой модуль (например, модуль нотификаций) может подписаться и
предупредить Суверена: «Государство недоступно снаружи».
