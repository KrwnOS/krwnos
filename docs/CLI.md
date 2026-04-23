# `krwn` — Krwn CLI

> Пульт управления цифровым государством. Дает Суверену делать
> «магические» вещи из терминала.

---

## Установка

```bash
npm i -g @krwnos/cli
# или из монорепо:
npm link -w cli
```

Требуется Node ≥ 20 (для `node:util.parseArgs` и `fetch`).

---

## Профили и конфиг

Конфиг хранится в `$XDG_CONFIG_HOME/krwnos/config.json`
(по умолчанию `~/.config/krwnos/config.json`, права `0600`).

```bash
krwn login \
  --host https://myclan.krwnos.app \
  --token kt_XXXXXXXXXXXXXXXX \
  --profile home
```

Токены минтятся в веб-UI: **Settings → CLI Tokens** (или через
API `/api/cli/tokens`). Каждый токен привязан к одному State и
несёт scope-список — принцип минимальных привилегий.

---

## Команды

### `krwn module <sub>`

```bash
krwn module install finance
krwn module install treasury --version 1.2.0
krwn module install ./finance.krwn --trusted-key ./publisher.pub
krwn module list
krwn module validate ./path/to/module-or-krwn.module.json
krwn module sign ./path/to/module --key ./priv.pem --out ./module.krwn
krwn module verify ./module.krwn --trusted-key ./publisher.pub
```

`validate` читает `krwn.module.json` (или каталог, в котором он лежит)
и проверяет его против JSON Schema из `@krwnos/sdk` — без сети и без
профиля CLI. Удобно перед публикацией пакета модуля.

Под капотом установки: `POST /api/cli/modules` с проверкой scope
`modules.write`. Тело запроса может включать поле `manifest` с
содержимым `krwn.module.json`; сервер отклонит установку с `400`, если
манифест невалиден или `slug` в манифесте не совпадает с `slug` в
запросе. Модуль должен быть зарегистрирован в Registry билда
(`src/modules/index.ts`) — иначе 404.

#### Подписанные пакеты `.krwn`

`krwn module sign <dir> --key <priv.pem> --out <file.krwn>` упаковывает
каталог в `.krwn` (gzip-tar с разделами `krwn.module.json`, `module/**`,
`SIGNATURE`). Подписывает Ed25519 — формат подробно описан в
`docs/MODULE_GUIDE.md` «Подпись и распространение модулей». Ключ
должен быть в PEM PKCS#8:

```bash
# сгенерировать пару один раз
openssl genpkey -algorithm Ed25519 -out publisher.pem
openssl pkey -in publisher.pem -pubout -out publisher.pub

# подписать
krwn module sign ./modules/finance \
     --key ./publisher.pem \
     --out ./dist/finance.krwn \
     --publisher krwnos.core
```

`krwn module verify <file.krwn>` — read-only проверка подписи и
целостности. При неудаче печатает причину
(`invalid_archive`/`manifest_invalid`/`signature_mismatch`/
`untrusted_signer`/`tampered_payload`) и выходит с кодом `1`.
Доверенные ключи берутся из:

- `--trusted-key <pub.pem>` (повторяемый флаг), либо
- `KRWN_TRUSTED_MODULE_PUBKEYS` — `:`/`\n`-разделённые PEM-пути.

`krwn module install <file.krwn>` — сначала проверяет подпись теми же
правилами, затем POST-ит извлечённый `manifest` в
`/api/cli/modules`. Сервер повторной распаковкой архива не занимается
— CLI уже доказал подлинность (см. `docs/MODULE_GUIDE.md`, решение
option "a").

### `krwn vertical <sub>`

```bash
krwn vertical add "Ministry of Defense"
krwn vertical add "General" --parent ver_abc --type position
krwn vertical list
```

Формат дерева в `list` — отступы-потомки, id подсвечены серым.

### `krwn invite`

Выпускает **magic link**. Токен показывается один раз — дальше
только SHA-256 в БД.

```bash
krwn invite \
  --node ver_recruit \
  --label "Recruit 2026" \
  --ttl 7d \
  --max-uses 25
```

Формат `--ttl`: `60s`, `30m`, `12h`, `7d`, или число в миллисекундах.

**Output:**
```
✦ Invitation issued
  code:  KRWN-7HX2-9KQ4
  uses:  0/25
  exp:   2026-04-25T11:00:00.000Z

Share this link once — it is never shown again:
  https://myclan.krwnos.app/invite/1XB6...
```

### `krwn backup`

Создаёт полный слепок State (vertical + memberships + modules +
invitations) в локальный JSON.

```bash
krwn backup --out ./krwn-backup.json
krwn backup list
```

Формат слепка стабилизирован `schemaRev` — старые бэкапы
читаются новыми билдами вплоть до breaking-change миграции.

### `krwn token rotate`

Заменяет текущий токен: выпускает новый с теми же scope и сроком
жизни (если не переопределены), отзывает старый и автоматически
обновляет локальный профиль.

```bash
krwn token rotate
krwn token rotate --label "daily-ops"
krwn token rotate --scopes "vertical.*,modules.read" --ttl 30d
```

**Grace-период отсутствует.** Старый токен перестаёт работать
мгновенно. Если что-то упадёт между server-ok и save-конфига —
восстановите профиль через web (`/setup` после коронации показывает
кнопку ротации) или сгенерируйте новый токен в настройках.

### `krwn status`

```bash
krwn status
```
```
host:     https://myclan.krwnos.app
tier:     pro
version:  0.1.0
tunnel:   cloudflared → https://myclan.krwnos.app
```

---

## Debug

```bash
KRWN_DEBUG=1 krwn module list
```

Печатает полный стек ошибок. Обычный режим — лаконичный.
