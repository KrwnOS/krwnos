# `deploy/web/` — статический контент для krwnos.com

Содержимое этой папки загружается на shared-хостинг (20i или любой
другой с Apache + `.htaccess`). Два поддомена, обслуживаемые одним и
тем же shared-хостингом.

## Структура

```
deploy/web/
├─ www/                    # → загрузить в корень krwnos.com (public_html/)
│  ├─ index.html           # лендинг
│  ├─ .htaccess            # принудительный HTTPS
│  └─ robots.txt
└─ get/                    # → загрузить в корень get.krwnos.com
   ├─ index.html           # редирект на install.sh для браузеров
   ├─ install.sh           # (копия из ../../scripts/install.sh)
   ├─ install.ps1          # (копия из ../../scripts/install.ps1)
   └─ .htaccess            # Content-Type: text/plain + HTTPS
```

## Как это работает

Пользователь выполняет:

```bash
curl -sSL https://get.krwnos.com | bash
```

→ `curl` идёт на `get.krwnos.com`,
→ `.htaccess` отдаёт `install.sh` как `text/plain`,
→ bash исполняет скрипт.

Установка происходит **на машине пользователя**, не на вашем
shared-хостинге. 20i здесь — просто CDN для одного .sh файла.

## Обновление installer

При любом изменении `scripts/install.sh` в репозитории — скопируйте
файл в `deploy/web/get/install.sh` и загрузите на FTP заново. Либо
настройте GitHub Action, который после мержа в `main` пушит файл на
хостинг (см. `.github/workflows/publish-installer.yml` — будущая
задача).

## Как загружать на 20i

1. My20i → выбрать ваш hosting package → **FTP** → создайте FTP
   аккаунт.
2. Подключитесь клиентом (FileZilla / WinSCP) — хост `sftp.20i.com`
   или подобный (см. My20i).
3. Для `krwnos.com`:  
   залить `www/*` в `public_html/` (или `sites/krwnos.com/`).
4. Для `get.krwnos.com`:  
   - Сначала в панели: **Manage Hosting → Subdomains → Add**
     `get.krwnos.com`, указать document root, например
     `public_html/get/`.
   - Залить `get/*` в эту папку.

## SSL

20i даёт бесплатный Let's Encrypt для главного домена и поддоменов
автоматически. В панели: **Manage Hosting → SSL / TLS → AutoSSL**.
После активации HTTPS редирект в `.htaccess` начинает работать.
