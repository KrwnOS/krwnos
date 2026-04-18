# Разработка модуля для KrwnOS

Плагин — это автономное приложение, которое расширяет возможности
конкретного State. Ядру известно про модуль только то, что он сам о себе
объявил через интерфейс `KrwnModule`.

---

## 1. Минимальный модуль: «Hello, Vertical»

```ts
// src/modules/hello/index.ts
import type { KrwnModule } from "@/types/kernel";

export const helloModule: KrwnModule = {
  slug: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Простейший модуль для проверки интеграции.",

  init() {
    return {
      permissions: [
        {
          key: "hello.view",
          owner: "hello",
          label: "Видеть виджет Hello",
          description: "Разрешает показывать приветственный виджет.",
        },
      ],
    };
  },

  getWidget(ctx) {
    if (!ctx.permissions.has("hello.view")) return null;
    return {
      id: "greeting",
      title: "Hello, Vertical",
      component: () => null, // подключите свой React-компонент
      defaultSize: "sm",
    };
  },

  getSettings() {
    return null;
  },
};
```

Регистрация в `src/modules/index.ts`:

```ts
import { registry } from "@/core";
import { helloModule } from "./hello";

export async function bootstrapModules() {
  await registry.register(helloModule);
}
```

---

## 2. Правила слага

- Глобально уникален.
- Нижний регистр, dot-разделитель: `treasury`, `treasury.reports`,
  `core.chat`.
- Префикс `core.*` зарезервирован за первопартийными модулями ядра.

---

## 3. Permissions

Каждое право, которое модуль собирается проверять, **обязано** быть
задекларировано в `init()`:

```ts
{
  key: "treasury.transaction.create",
  owner: "treasury",        // равен slug модуля
  label: "Создавать транзакции",
  description: "Разрешает списание и зачисление средств."
}
```

Формат ключа: `<domain>.<action>` (допускается вложенность
`<domain>.<subdomain>.<action>`). Суверен может использовать wildcard
`treasury.*` или `*` (super-power).

Проверка на сервере:

```ts
import { permissionsEngine } from "@/core";

const granted = permissionsEngine.can(
  { stateId, userId, isOwner, snapshot },
  "treasury.transaction.create",
);
if (!granted) throw new Error("Forbidden");
```

---

## 4. Event Bus

Модуль публикует события в формате `"<slug>.<action>"`:

```ts
await ctx.bus.emit("treasury.transaction.created", {
  stateId: ctx.stateId,
  amount: 100,
  currency: "KRW",
  actorId: ctx.userId,
});
```

Другие модули подписываются:

```ts
ctx.bus.on<TreasuryTxPayload>("treasury.transaction.created", async (evt) => {
  await sendChatMessage(`Перевод ${evt.amount} ${evt.currency}`);
});
```

Канонические события ядра — в `KernelEvents` (см. `core/event-bus.ts`).

---

## 5. UI: Widget vs Settings

| Метод | Назначение | Кому показывается |
|-------|-----------|-------------------|
| `getWidget(ctx)` | Виджет на рабочем столе пользователя. | Всем, кто прошёл `requiredPermission`. |
| `getSettings(ctx)` | Панель конфигурации модуля. | Суверен + держатели `requiredPermission`. |

Оба метода вызываются **на каждый рендер** shell'а — держите их
дешёвыми и без сайд-эффектов.

---

## 6. Жизненный цикл

```
register() ──► init() ──► (установка в State) ──► getWidget/getSettings...
                                                        │
                                        ┌───────────────┘
                                        ▼
                           ModuleContext ({stateId, userId, permissions, bus, logger})
```

Модуль никогда не хранит глобальное состояние, привязанное к
конкретному State — всё идёт через `ModuleContext`.

---

## 7. Чего делать **нельзя**

- ❌ Импортировать из другого модуля напрямую. Общение только через
  Event Bus и публичные контракты.
- ❌ Импортировать Prisma / Redis из `/src/lib`. Модуль получает API
  ядра через `ModuleContext`.
- ❌ Хардкодить права — только через `PermissionDescriptor`.
- ❌ Проверять роль пользователя по имени узла. Используйте
  `PermissionKey`.

---

## 8. Чек-лист перед мержем модуля

- [ ] `slug` уникален и следует конвенции.
- [ ] Все проверяемые `PermissionKey` задекларированы в `init()`.
- [ ] Есть README с описанием что модуль делает и какие права вводит.
- [ ] Нет импортов из других модулей / `lib/prisma` / `lib/redis`.
- [ ] Виджет корректно возвращает `null`, когда нет прав.
- [ ] Документирована схема payload-ов событий, которые модуль
      публикует.
