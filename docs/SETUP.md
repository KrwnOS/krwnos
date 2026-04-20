# Setup — первичная коронация Суверена

Три способа инициализировать KrwnOS. Все три — идемпотентны:
повторный запуск после успеха возвращает ошибку `already_initialised`
(exit code 2 / HTTP 409).

---

## 1. Web Wizard — `/setup`

Для Cloud tier и пользователей без shell-доступа:

1. Откройте `https://<your-host>/setup`.
2. Заполните форму: название государства, @handle, опционально email.
3. Нажмите **«Короновать Суверена»**.
4. Сохраните показанный **bootstrap CLI-токен** (он выводится один раз).
5. Сразу после создания доступна кнопка **«Заменить bootstrap-токен»**
   — она отзывает первичный токен и выпускает новый, а страница
   показывает уже его. Рекомендуется всегда нажимать.

После успешного setup страница `/setup` начинает редиректить на `/`.

---

## 2. CLI — интерактивный

```bash
npm run setup
# или
docker compose -f deploy/docker-compose.yml exec app npm run setup
```

Раннер зачитывает ответы через `readline/promises`, никаких
сторонних зависимостей. В конце печатает CLI-токен и готовую
команду `krwn login ...`.

---

## 3. CLI — неинтерактивный (для CI и образов)

```bash
npm run setup -- \
  --state "Crown Republic" \
  --slug crown-republic \
  --handle redmaster \
  --email red@example.com \
  --display "Red Master" \
  --yes \
  --json
```

Вывод с `--json`:

```json
{
  "ok": true,
  "userId": "clr...",
  "stateId": "clr...",
  "stateSlug": "crown-republic",
  "sovereignNodeId": "clr...",
  "cliToken": "kt_...",
  "cliTokenId": "clr..."
}
```

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | ok |
| 1 | generic failure |
| 2 | already initialised |
| 64 | invalid usage (EX_USAGE) |

Все флаги — см. `npm run setup -- --help`.

---

## HTTP API

```
GET  /api/setup   → { "initialised": boolean }
POST /api/setup   → body: { stateName, ownerHandle, ... }
                  → 201 { stateId, stateSlug, cliToken, ... }
                  → 409 { error: "already_initialised" } — если уже инициализирован
                  → 400 { error: "validation_failed", issues: [...] }
```

Эндпоинт **не требует аутентификации** — по определению first-run
происходит до появления первого пользователя. Сама защита —
`state.count() > 0` в транзакции.

---

## Что создаёт setup

В одной Prisma-транзакции:

1. `User` — с нормализованным `@handle` (lowercase, strip `@`, `[a-z0-9_]{3,32}`).
2. `State` — со slug-ом (auto из `stateName`, 48 chars, Unicode-aware).
   `config.flags.firstRunCompleted = true`.
3. `VerticalNode` — корневой, `title: "Sovereign"`, `type: "rank"`,
   `permissions: ["*"]`, `parentId: null`. Это и есть «высший
   уровень вертикали»: Power Engine трактует `"*"` как супер-право.
4. `Membership` — связь Суверена с корневым узлом.
5. `CliToken` — с `scopes: ["*"]`, `label: "bootstrap"`.

Plaintext-токен возвращается один раз и сразу хешируется в БД
(`tokenHash = sha256(token)`).

---

## Ротация bootstrap-токена

Первичный токен подписан `"bootstrap"` для аудита. Настоятельно
рекомендуется заменить его сразу после логина:

```bash
krwn token rotate --label "daily-ops"
```

CLI получит новый токен, автоматически обновит локальный профиль
(`~/.config/krwnos/config.json`) и отзовёт предыдущий токен на
сервере. Grace-периода нет — старый токен перестаёт работать
мгновенно.

Через web — кнопка на странице результата `/setup` или
`POST /api/cli/tokens/rotate` с заголовком
`Authorization: Bearer <current-token>`.

Интеграционные тесты `setupState` в Vitest: задайте `TEST_DATABASE_URL`
(тот же Postgres, что и `DATABASE_URL`, после `prisma migrate deploy`).

---

## Telegram (опционально)

Привязка Telegram к аккаунту идёт через `CredentialsRegistry` и Bearer CLI
(см. scope `credentials.telegram.link` в ядре). Переменные окружения и
webhook описаны в [`DEPLOYMENT.md`](./DEPLOYMENT.md) (раздел «Telegram bot»).

---

## E2E (Playwright)

Локально: поднимите Postgres (и при желании Redis), задайте `DATABASE_URL` и
`AUTH_SECRET` (≥32 символа), выполните `npx prisma migrate deploy`, затем
соберите приложение и запустите браузерные смоки:

```bash
npm run build && npm run test:e2e
```

Первый прогон ставит `npx playwright install` (браузеры). В CI см.
`.github/workflows/ci.yml` (job после unit-тестов: migrate → build → Playwright).
