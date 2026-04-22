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

## Дальнейшие шаги

См. `docs/ROADMAP.md`, Horizon 3: песочница БД, подписанные пакеты, маркетплейс.
