# /src/modules

Каждый плагин KrwnOS живёт в собственной подпапке и экспортирует объект,
реализующий `KrwnModule` из `@/types/kernel`.

> Ядро (`/src/core`) **никогда** не импортирует ничего из этой папки
> напрямую. Связывание происходит в `src/modules/index.ts` через
> `registry.register()`.

См. [`docs/MODULE_GUIDE.md`](../../docs/MODULE_GUIDE.md) для пошаговой
инструкции по созданию плагина.
