# core.wallet

Финансовый уровень KrwnOS — личные кошельки граждан, казна узлов
Вертикали и атомарные переводы внутренней валюты («Крона», ⚜).

## Slug

`core.wallet`

## Permissions

| Key                      | Назначение                                                                                         |
|--------------------------|----------------------------------------------------------------------------------------------------|
| `wallet.view_own`        | Видеть баланс и историю своего личного кошелька.                                                   |
| `wallet.view_treasury`   | Видеть казну узла (и подузлов). Дополнительно требуется членство в узле или его предке.            |
| `wallet.transfer`        | Инициировать перевод. Для траты из казны — членство в узле (или его предке) + `wallet.view_treasury`. |
| `wallet.manage_treasury` | Распоряжаться казной узла (списывать средства). Наследуется по Вертикали.                          |
| `wallet.admin_mint`      | Эмитировать новые единицы валюты. По умолчанию — только Суверен.                                   |
| `wallet.manage_assets`   | Фабрика Валют: создавать / снимать с оборота активы государства (`StateAsset`).                    |

## Модели БД

* `StateAsset` — единица учёта («национальная валюта» или её альтернативы).
  Поля: `symbol` (`"KRN"`, `"GOLD"`, `"ETH"`...), `name`, `type`
  (`INTERNAL` / `ON_CHAIN`), `mode` (`LOCAL` / `EXTERNAL` / `HYBRID`),
  `contractAddress` + `network` + `chainId` (для `ON_CHAIN` / `HYBRID`),
  `decimals` (по умолчанию 18), `exchangeRate` (для `HYBRID`),
  `isPrimary` (флаг национальной валюты — ровно одна на State).
* `Wallet` — кошелёк. Поля: `type` (`PERSONAL`/`TREASURY`), `userId` (для личных),
  `nodeId` (для казны), `address` (внутренний `krwn1…`), `balance: Float`,
  `assetId` → `StateAsset`, `currency` — денормализованный `asset.symbol`,
  `externalAddress` (реальный `0x…` / base58 для ON_CHAIN / HYBRID),
  `lastSyncedAt` + `lastSyncedBlock` — курсор Treasury Watcher'а.
  У одного пользователя могут быть параллельные кошельки в разных активах:
  уникальность — по `(stateId, userId, assetId)`.
* `Transaction` — история. Поля: `fromWalletId`, `toWalletId`, `amount: Float`,
  `assetId`, `currency`, `kind` (`transfer` / `treasury_allocation` /
  `mint` / `burn`), `status`, `metadata`, `externalTxHash` и
  `externalStatus` (для Web3-переводов: `intent_prepared` →
  `broadcasting` → `confirmed` / `failed` / `dropped`).

## Currency Factory (Фабрика Валют)

Каждое государство выбирает режим учёта своего актива:

| Режим      | Где живёт баланс        | Когда выбирать                                  |
|------------|-------------------------|-------------------------------------------------|
| `LOCAL`    | Только Postgres         | Закрытые компании, малые кланы, быстрый учёт.   |
| `EXTERNAL` | Реальный смарт-контракт | Импорт существующего ERC-20 / SPL токена.       |
| `HYBRID`   | Postgres + пег в цепочку| Расчёты мгновенные; `Withdraw` — по курсу.      |

Логика — в `src/modules/wallet/settings.ts` (`CurrencyFactoryService`).
Доступ — `wallet.manage_assets` (или Суверен). Панель настроек называется
«Настройка национальной валюты» и экспонируется через `module.getSettings()`.

> `Float` для денег удобен, но даёт IEEE-754 округления. Для боевых
> ledger-систем лучше `Decimal` — см. комментарий в `prisma/schema.prisma`.

## Web3-слой

Когда актив — `ON_CHAIN` (или `HYBRID` с `Withdraw`), сервер не
держит приватных ключей. Он лишь:

1. Собирает **unsigned intent** (`ERC-20 transfer(to,uint256)`) через
   `viem` — см. `src/modules/wallet/providers/evm.ts`.
2. Возвращает клиенту `{ chainId, to, data, value, humanReadable }`.
3. Клиент подписывает через MetaMask / WalletConnect и броадкастит.
4. Присылает `externalTxHash` обратно — сервис сохраняет его на
   pending-транзакции.
5. **Treasury Watcher** (`src/modules/wallet/watcher.ts`) опрашивает
   RPC: читает `balanceOf` на реальном контракте, синхронизирует
   `wallet.balance`, ловит `receipt.status` и флипает
   `Transaction` в терминальное состояние (`completed` / `failed`).

Поддерживаемые сети по умолчанию — Ethereum, Polygon, Arbitrum,
Optimism, Base, BSC, Avalanche. RPC задаётся через env
`KRWN_RPC_<NETWORK>` (напр. `KRWN_RPC_POLYGON`). Для добавления
новой сети достаточно положить новый `ChainProvider` в
`providers/` и зарегистрировать его.

Запуск Watcher'а:

```bash
npm run watcher:treasury             # daemon, poll каждые 30с
npm run watcher:treasury -- --once   # single tick (для CI / cron)
npm run watcher:treasury -- --state <id> --interval 10000
```

Эмитируемые события:

| Событие                                | Когда                                                   |
|----------------------------------------|---------------------------------------------------------|
| `core.wallet.on_chain.intent_prepared` | Сервер подготовил intent, клиент должен подписать.      |
| `core.wallet.on_chain.broadcasted`     | Клиент прислал `externalTxHash`, ждём финализации.      |
| `core.wallet.on_chain.settled`         | Watcher увидел terminal status (`confirmed` / `failed`).|
| `core.wallet.balance.synced`           | Watcher обновил `wallet.balance` из блокчейна.          |

HTTP-роуты Web3-потока:

| Роут                                   | Назначение                                  |
|----------------------------------------|---------------------------------------------|
| `POST /api/wallet/transfer`            | Внутренний / LOCAL / HYBRID-internal леджер.|
| `POST /api/wallet/transfer/intent`     | Собрать unsigned intent для ON_CHAIN.       |
| `POST /api/wallet/transfer/confirm`    | Привязать `externalTxHash` к pending-записи.|

## Правила распоряжения

* **Гражданин (Citizen).** Видит и тратит только свой личный кошелёк.
* **Министр (Minister).** Держит `wallet.view_treasury` на свой узел —
  видит бюджет, может выплачивать подчинённым (при наличии `wallet.transfer`).
  Правило ветвления — «вижу казну = могу распоряжаться» (симметрия с chat.read).
* **Суверен.** Имеет неявный `*` — может mint'ить, создавать казны любых узлов,
  переводить откуда угодно куда угодно.

## Атомарность

`executeTransfer()` в `repo.ts` оборачивает `wallet.update(decrement)`,
`wallet.update(increment)` и `transaction.create(status=completed)` в один
`prisma.$transaction`. При `balance < amount` выбрасывается
`insufficient_funds`, весь блок откатывается и параллельно пишется
`Transaction` со `status=failed` для audit log.

## Realtime

При успешном переводе сервис публикует событие
`core.wallet.transaction.created` через `eventBus`:

```ts
interface WalletTransactionCreatedEvent {
  stateId: string;
  transaction: WalletTransaction;
  recipientUserIds: string[]; // участники + ветвь членов узла
}
```

## Точки подключения

* `src/modules/wallet/index.ts` — `coreWalletModule` (`KrwnModule`),
  регистрируется в `src/modules/index.ts`.
* `src/modules/wallet/service.ts` — доменная логика, `WalletService`,
  `prepareOnChainIntent()` + `confirmOnChainTransfer()`.
* `src/modules/wallet/settings.ts` — `CurrencyFactoryService` (Фабрика Валют).
* `src/modules/wallet/providers/` — `ChainProvider` + viem-адаптер + registry.
* `src/modules/wallet/watcher.ts` — `TreasuryWatcher` (синхронизация
  казны с блокчейном).
* `src/modules/wallet/repo.ts` — Prisma-адаптеры: `createPrismaWalletRepository`,
  `createPrismaCurrencyFactoryRepository`, `createPrismaWatcherPersistence`.
* `scripts/treasury-watcher.ts` — запускаемый процесс
  (`npm run watcher:treasury`).
* `src/app/api/wallet/*` — HTTP API (balance, treasuries, transfer,
  history, Web3 intent / confirm).
