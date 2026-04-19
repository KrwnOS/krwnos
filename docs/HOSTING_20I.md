# Хостинг на 20i.com — пошаговый план

> Вы зарегистрировали `krwnos.com` на 20i. У вас только домен.
> Этот документ — полный чеклист: что купить, куда залить,
> какие DNS-записи выставить.

---

## TL;DR

**Shared-хостинг 20i** (их самый дешёвый «Web Hosting») покрывает:
- лендинг `krwnos.com`
- инсталлер `get.krwnos.com`

Сам **KrwnOS (Next.js + Postgres + Redis)** на shared НЕ запустится —
для него нужна виртуалка. Рекомендую **Hetzner CX22 (~€4/мес)** или
DigitalOcean Basic Droplet (~$6/мес). 20i тоже продаёт VPS, но
дороже за те же ресурсы.

---

## 1. Что купить у 20i

### Обязательно
- **Web Hosting** (Basic / Home plan) — £1–5/мес. Этого пакета
  достаточно для статики `krwnos.com` и `get.krwnos.com`.

### НЕ нужно
- ~~WordPress Hosting~~ — вам не нужен WordPress.
- ~~Reseller Hosting~~ — это для тех, кто перепродаёт хостинг.
- ~~Managed VPS на 20i~~ — можно, но за те же деньги есть
  варианты в 2–3 раза мощнее.

### Для самого приложения (отдельно от 20i)
- **Hetzner CX22** (2 vCPU / 4 GB RAM / 40 GB NVMe) — ~€4/мес.
  Лучший выбор по цене/мощности в EU.
- **DigitalOcean** Basic Droplet — $6/мес, удобнее UI.
- **Oracle Cloud Free Tier** (ARM 4 vCPU / 24 GB) — $0, но
  регистрация бывает капризной.

---

## 2. Структура доменов

```
krwnos.com              → 20i Shared Hosting  (лендинг)
get.krwnos.com          → 20i Shared Hosting  (installer .sh / .ps1)
app.krwnos.com          → ВАШ VPS (опционально — ваш личный State)
*.krwnos.com            → ВАШ VPS (в будущем Cloud tier: публичные State-ы)
```

«Main State» и Cloud tier живут на VPS. Shared у 20i — только
визитка и скрипт.

---

## 3. Что куда класть

В репозитории всё подготовлено в папке `deploy/web/`:

```
deploy/web/
├── www/            # → залить в document root krwnos.com
│   ├── index.html
│   ├── .htaccess
│   └── robots.txt
└── get/            # → залить в document root get.krwnos.com
    ├── index.html
    ├── install.sh
    ├── install.ps1
    └── .htaccess
```

Файлы готовы — никакого билда не нужно, просто FTP/SFTP.

---

## 4. Пошагово в панели 20i

### Шаг 1 — создать hosting package

1. My20i → **Buy Hosting** → Web Hosting → выбрать план (самый
   дешёвый подойдёт).
2. Привязать к `krwnos.com`.
3. Дождаться провижна (обычно < 5 мин).

### Шаг 2 — включить AutoSSL

**Manage Hosting → SSL / TLS → AutoSSL** → Enable. Это бесплатный
Let's Encrypt. Без него `.htaccess`-редиректы на HTTPS не имеют
смысла.

### Шаг 3 — создать поддомен get.krwnos.com

1. **Manage Hosting → Subdomains → Add New Subdomain**.
2. Prefix: `get`, domain: `krwnos.com`.
3. Document Root: `public_html/get/`.
4. Сохранить.

### Шаг 4 — залить файлы по FTP

1. **Manage Hosting → FTP Accounts** → создать аккаунт (логин +
   пароль).
2. Подключиться FileZilla / WinSCP:
   - Host: `sftp.20i.com` (или как указано в панели)
   - Protocol: SFTP
   - Port: 22
3. Залить:

   | Локально | → На сервер |
   |----------|-------------|
   | `deploy/web/www/*` | `/public_html/` |
   | `deploy/web/get/*` | `/public_html/get/` |

   > Важно: `.htaccess` — скрытый файл. Включите «show hidden»
   > в клиенте перед загрузкой.

### Шаг 5 — проверить

```bash
curl -I https://krwnos.com              # 200 OK, text/html
curl -I https://get.krwnos.com          # 200 OK, text/plain
curl -sSL https://get.krwnos.com | head # начало install.sh
```

Если `curl -sSL https://get.krwnos.com | bash` отрабатывает —
инсталлер живой.

---

## 5. DNS (если DNS на 20i)

20i по умолчанию держит DNS за вас. Когда вы привязали
`krwnos.com` к hosting package, основная A-запись уже указывает
на shared-сервер. Для `get.krwnos.com` поддомен создаётся
автоматически при шаге 3. Ничего руками трогать не надо.

**Когда понадобится руками:**

| Когда | Запись | Значение |
|-------|--------|----------|
| Поднимете свой VPS | A `app.krwnos.com` | `<IP вашего VPS>` |
| Запустите Cloud tier | A `*.krwnos.com` | `<IP вашего VPS>` или CNAME tunnel |
| Cloudflare Tunnel | CNAME `app.krwnos.com` | `<tunnel-id>.cfargotunnel.com` |

DNS-панель 20i: **Manage Domain → DNS**.

---

## 6. Когда пойти за VPS

Сейчас у вас:
- ✓ Лендинг.
- ✓ Инсталлер (`curl | bash` для ваших пользователей).

Этого достаточно, чтобы распространять KrwnOS — **каждый
пользователь ставит его на СВОЙ сервер**. Вам не нужно ничего
больше, пока вы не захотите:

1. **Запустить свой личный State** — например, для тестирования
   или внутреннего клана. Тогда берёте VPS и ставите через тот
   же `curl | bash` (получите полноценное государство на
   `app.krwnos.com`).

2. **Сделать Cloud tier публичным** — чтобы пользователи
   нажимали «Deploy» и получали `myclan.krwnos.com` автоматически.
   Тогда нужен:
   - один VPS с Docker + orchestrator (Phase 5 в roadmap);
   - wildcard DNS `*.krwnos.com` → VPS;
   - Cloudflare Tunnel или Traefik для маршрутизации по host-header.

На старте — **не нужно, не тратьте деньги преждевременно**.

---

## 7. Быстрый чеклист

- [ ] Купить Web Hosting на 20i, привязать к `krwnos.com`.
- [ ] Включить AutoSSL.
- [ ] Создать поддомен `get.krwnos.com` с document root `public_html/get/`.
- [ ] Залить `deploy/web/www/*` в `public_html/`.
- [ ] Залить `deploy/web/get/*` в `public_html/get/`.
- [ ] Проверить `https://krwnos.com` и `curl https://get.krwnos.com`.
- [ ] Опубликовать репозиторий на GitHub (ссылка из лендинга).
- [ ] (Опционально, позже) Взять VPS, прогнать свой инсталлер,
      поднять свой State на `app.krwnos.com`.

---

## 8. Частые вопросы

**«Можно ли вообще запустить Next.js на shared 20i?»**
Технически — на некоторых планах есть Node.js через Phusion
Passenger. На практике вы не получите там Postgres + Redis +
долгоживущих процессов. Не пытайтесь.

**«А Vercel?»**
Вариант: Next.js на Vercel + Supabase (Postgres) + Upstash (Redis).
Тогда `krwnos.com` может быть самим приложением, без отдельного
лендинга. Но цена за «бесплатность» — Vercel serverless, и вам
придётся переделать Event Bus под HTTP pull вместо long-lived
pub/sub. Технически возможно, но в MVP — усложнение. Сейчас
рекомендую классический VPS.

**«Что если 20i задвигает свою рекламу / рамки?»**
Обычные shared-планы 20i не вставляют рекламу. Но проверьте
AUP конкретного тарифа перед покупкой.

**«Получил `ERR_TOO_MANY_REDIRECTS` после заливки»**
Типичная ловушка 20i: SSL терминируется на их фронт-прокси,
и внутри Apache переменная `%{HTTPS}` всегда равна `off`.
Наивное правило `RewriteCond %{HTTPS} !=on` поэтому срабатывает
на каждом запросе → прокси принимает HTTPS → раскрывает как
HTTP → Apache снова редиректит → петля.

Правильный индикатор — заголовок `X-Forwarded-Proto`, который
20i прокидывает от прокси. В наших `deploy/web/*/htaccess`
сначала идёт `RewriteCond %{HTTP:X-Forwarded-Proto} !=https`,
и только потом стандартная проверка `%{HTTPS}`. Если пишете
свой `.htaccess` — поставьте эту же пару условий.

**«Нужен ли CDN?»**
Для двух статических файлов — нет. Если позже захотите глобальный
CDN — Cloudflare перед 20i бесплатно (поставить Cloudflare NS
вместо 20i NS, proxy = on для `krwnos.com`).
