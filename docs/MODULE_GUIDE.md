# Руководство по модулям KrwnOS

Модули — это плагины с контрактом `KrwnModule`, которые регистрируются в `ModuleRegistry` и получают минимальный контекст `ModuleContext` от ядра.

## Пакет `@krwnos/sdk`

Код: `packages/sdk`. После сборки публикуется как `@krwnos/sdk`.

### Типы

`KrwnModule`, `ModuleContext`, `ModuleAuth`, `ModuleEventBus`, `ModuleLogger`, `ModuleWidget`, `ModuleSettingsPanel`, `PermissionKey`, `PermissionDescriptor`, `KrwnError`.

`ModuleContext.auth` — опциональный объект `ModuleAuth = { userId: string }` с идентичностью вызывающего. `null` означает системный вызов (фоновая задача, хук жизненного цикла, событие ядра); при пользовательских вызовах модуль может рассчитывать на `ctx.auth.userId`. Поле `ctx.userId` сохранено ради обратной совместимости — новому коду следует предпочитать `ctx.auth?.userId`. `KrwnError` — базовый класс ошибок модуля с полями `message` и `code`, например `throw new KrwnError("Missing tasks.read permission", "FORBIDDEN")`; код используется роутами для маппинга на HTTP-статус.

В монорепозитории приложения те же типы доступны из `@/types/kernel` (реэкспорт из SDK — обратная совместимость).

### Manifest (`krwn.module.json`)

- Тип: `KrwnModuleManifest`.
- Валидация JSON: `validateKrwnModuleManifest(unknown)` и схема `krwnModuleManifestJsonSchema` (Ajv, draft 2020-12).

### Postgres: схема на модуль / per-state

Хелперы в `prisma-per-schema.ts`:

- `normalizeSchemaToken`, `modulePostgresSchemaName(moduleSlug, stateIdPrefix)` — изолированное имя схемы `krwn_<slug>_<prefix>` с лимитом 63 символа.
- `quotePostgresIdentifier`, `formatPostgresSearchPath` — для `search_path` и DDL.

Отдельный файл Prisma на модуль и multi-schema datasource — в Roadmap (Horizon 3); хелперы задают соглашение об именах заранее.

### Тест-harness

- `createTestModuleContext` — контекст с in-memory bus и noop-логгером (дефолты: `stateId`, `userId`, wildcard `*` в permissions).
- `createMemoryEventBus`, `createNoopModuleLogger` — если нужны отдельно.
- `runModuleHarness(mod, options?)` — `await init()`, затем `getWidget` / `getSettings` с тестовым контекстом.

Пример:

```ts
import type { KrwnModule, PermissionKey } from "@krwnos/sdk";
import { runModuleHarness } from "@krwnos/sdk";

const myModule: KrwnModule = {
  slug: "acme.hello",
  name: "Hello",
  version: "1.0.0",
  init() {
    return {
      permissions: [
        {
          key: "acme.hello.read" as PermissionKey,
          owner: "acme.hello",
          label: "Read hello",
        },
      ],
    };
  },
  getWidget: () => null,
  getSettings: () => null,
};

const { initResult, widget, settings } = await runModuleHarness(myModule, {
  stateId: "state_123",
  userId: null,
});
```

Правила permissions: ключи вида `domain.action`; `owner` в дескрипторе должен совпадать со slug модуля (или `"core"` для общих ключей ядра).

## Authentication in API routes

When building API routes that serve module features, use the shared authentication helper at `@/app/api/_shared/auth-context`. This helper:

- Validates CLI bearer tokens
- Loads the authenticated user's state and vertical structure
- Derives permissions through the PermissionsEngine
- Returns a `ModuleContext` ready for service calls

### Usage

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedContext } from "@/app/api/_shared/auth-context";
import { MyService } from "@/modules/mymodule/service";

export async function GET(req: NextRequest) {
  try {
    const { ctx, access } = await getAuthenticatedContext(req);
    const service = new MyService(/* deps */);
    const result = await service.doSomething(ctx, access);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    // Handle CliAuthError (401/400) and service errors
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
```

The returned `access` object includes `isOwner` and `snapshot` (the state's vertical structure and membership graph). Services may use this to filter results, enforce permissions, and structure responses.

## Подпись и распространение модулей

Модуль распространяется как файл `*.krwn` — **gzip-сжатый USTAR-tar**
со следующей внутренней схемой:

```
krwn.module.json     # манифест (валидируется через validateKrwnModuleManifest)
module/**            # исходное дерево модуля
SIGNATURE            # JSON с detached Ed25519-подписью и метаданными
```

Формат сознательно сделан простым и самодостаточным: любая сторонняя
реализация (в т.ч. будущий Marketplace `modules.krwnos.com`) может
перепроверить пакет без обращения к серверу публикации.

### Как считается `contentHash`

SHA-256 по упорядоченному (по пути, ASCII) списку всех записей архива
**кроме** `SIGNATURE`. Итоговый хеш — 32 байта; в файле `SIGNATURE`
хранится в hex.

### Что подписывается

Ed25519-подпись берётся над канонической нуль-разделённой строкой:

```
"krwn-package/v1" 0x00 publisherId 0x00 publicKeyFingerprint 0x00
signedAt 0x00 contentHash(32 байта)
```

Таким образом и контент, и метаданные (`publisherId`, `signedAt`,
отпечаток ключа) защищены от подмены — подмена любого поля ломает
подпись.

### Формат файла `SIGNATURE`

```json
{
  "version": "1",
  "algorithm": "Ed25519",
  "signedAt": "2026-04-23T12:34:56.000Z",
  "publisherId": "krwnos.core",
  "publicKeyFingerprint": "<sha256-префикс публичного ключа, 16 hex>",
  "contentHash": "<hex SHA-256 полезной нагрузки>",
  "signature": "<base64 сырого Ed25519-подписи, 64 байта>"
}
```

### CLI

Подписание:

```bash
krwn module sign ./path/to/module \
     --key ./publisher.pem \
     --out ./module.krwn \
     --publisher krwnos.core   # опционально
```

Верификация:

```bash
krwn module verify ./module.krwn --trusted-key ./publisher.pub
```

Установка из локального пакета:

```bash
krwn module install ./module.krwn --trusted-key ./publisher.pub
```

Позиционный аргумент `install` с расширением `.krwn` трактуется как
локальный файл; иначе — как slug модуля из реестра сборки. Старый путь
(`krwn module install finance`) сохранён без изменений.

**Решение по сборке (option "a")**: CLI самостоятельно верифицирует
пакет и отправляет валидированный `manifest` в существующий
`POST /api/cli/modules`. Сервер не дублирует распаковку — CLI уже
доказал авторство и целостность. Будущий `POST
/api/cli/modules/install-package` (option "b") со server-side
распаковкой в sandbox — отдельный пункт roadmap.

### Trust store

Отпечатки доверенных издателей хранятся в
`StateSettings.extras.trustedModulePublishers`:

```json
{
  "trustedModulePublishers": [
    { "id": "krwnos.core", "pubKeyPem": "-----BEGIN PUBLIC KEY-----..." }
  ]
}
```

Управляется через Палату Указов; permission-ключ
`modules.trust.manage` зарегистрирован в `registerCorePermissions()`
и по умолчанию виден только Суверену (`sovereignOnly: true`).

Для операторских / bootstrap-сценариев CLI также принимает:

- `--trusted-key <pubkey.pem>` (повторяемый флаг);
- переменную окружения `KRWN_TRUSTED_MODULE_PUBKEYS` —
  список путей, разделённых `:` или переводом строки.

Два источника объединяются; совпадение проверяется по
`publicKeyFingerprint`, а не по человекочитаемому `id` — так что
подмена id безвредна.

### TODO (намеренно вне scope этого PR)

- Ротация ключей издателя (сейчас `SIGNATURE.version = "1"`
  фиксирует протокол; политика ротации — отдельный пункт roadmap).
- Отзыв (revocation) скомпрометированных ключей — потребует
  append-only лога в trust-store либо внешнего OCSP-аналога.
- Marketplace `modules.krwnos.com`: индекс, категории, отзывы,
  распространение `.krwn` — следующий пункт Horizon 3.

## Дальнейшие шаги

См. `docs/ROADMAP.md`, Horizon 3: Marketplace и новые first-party модули.
