# core.chat

Первый функциональный модуль KrwnOS — встроенный чат Государства.

## Slug

`core.chat`

## Permissions

| Key           | Назначение                                                         |
|---------------|--------------------------------------------------------------------|
| `chat.read`   | Видеть каналы и читать сообщения.                                  |
| `chat.write`  | Публиковать сообщения в доступных каналах.                         |
| `chat.admin`  | Создавать и архивировать каналы, привязывать их к узлам Вертикали. |

## Модели

* `ChatChannel` — канал. Может иметь `nodeId` → `VerticalNode` (опционально).
* `ChatMessage` — сообщение. Привязано к `channelId`.

## Правило доступа к каналам, привязанным к узлу

Если у `ChatChannel.nodeId` задано значение, то Permissions Engine
дополнительно проверяет, является ли пользователь членом этого узла
**или любого из его родителей** вверх по Вертикали (метод
`PermissionsEngine.isMemberOfNodeOrAncestor`). Это отражает
«нисходящее» течение власти: глава министерства видит чаты всех
подотделов.

Суверен (владелец State) всегда имеет доступ ко всем каналам.

## Realtime

При успешном `postMessage()` сервис публикует событие
`core.chat.message.created` через `eventBus`:

```ts
interface ChatMessageCreatedEvent {
  stateId: string;
  channelId: string;
  nodeId: string | null;
  message: ChatMessage;
  recipientUserIds: string[]; // кому доставлять в активные сессии
}
```

Когда `eventBus` сконфигурирован как `RedisEventBus`, событие через
Redis pub/sub долетает до всех процессов/подов, где работают
SSE/WebSocket сессии клиентов.

## Точки подключения

* `src/modules/chat/index.ts` — `coreChatModule` (`KrwnModule`), регистрируется в `src/modules/index.ts`.
* `src/modules/chat/service.ts` — доменная логика.
* `src/modules/chat/repo.ts` — Prisma-адаптер `ChatRepository`.
* `src/app/api/chat/*` — HTTP API (list channels, post message, SSE stream).

## Не делает

* Не хранит прямые ссылки на React-компоненты (Dynamic UI загружает
  их лениво).
* Не импортирует ничего из `src/lib/*` напрямую — только абстракции
  ядра и собственный Prisma-адаптер.
