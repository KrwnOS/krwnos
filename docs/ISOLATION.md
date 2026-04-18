# Data Isolation — «Виртуальное приложение»

Каждое цифровое государство на KrwnOS — это индивидуальный набор
микро-сервисов, которые **никогда не пересекаются** с данными других
State, даже если все они живут в одной PostgreSQL-инстанции.

---

## Уровни изоляции

### 1. Ядро (`State`, `VerticalNode`, `Membership`, `Invitation`, ...)
Общие таблицы. Изоляция — через `stateId` FK на **каждой** записи.
Все запросы в репозиториях обязаны включать `where: { stateId }`.

**Инвариант:** ни один SELECT/UPDATE по таблице домена не выполняется
без `stateId`-фильтра. Покрыто тестами и linter-правилом (TODO).

### 2. Приватные данные модуля
Каждый установленный модуль получает выделенную **PostgreSQL schema**:

```
krwn_<slug>_<stateIdPrefix>
    e.g. krwn_treasury_cln9a7x2
         krwn_core_chat_cln9a7x2
```

Имя схемы хранится в `InstalledModule.dbSchema`. Модуль получает
ConnectionString вида:

```
postgresql://.../krwnos?schema=krwn_treasury_cln9a7x2
```

и живёт в своей песочнице: все `CREATE TABLE`, индексы, FK — внутри
schema. Дроп State = `DROP SCHEMA ... CASCADE` + удаление ядра.

### 3. Секреты модуля
Plugin-конфиг `InstalledModule.config` — JSONB, но для секретов
(API keys, webhook urls) обязательно шифрование на уровне приложения
(AEAD с ключом из `AUTH_SECRET`). Ядро предоставит helper
`vault.encrypt(stateId, plaintext)` — см. TODO Phase 4.

---

## Почему не «по БД на State»?

Обсуждалось, отвергнуто для MVP:

| Вариант | За | Против |
|---------|----|--------|
| Database-per-State | Полная изоляция, переносимость | Миграции кошмарные; 1000 государств = 1000 DB; connection pooling умирает |
| **Schema-per-module (текущий)** | Хорошая изоляция, одна миграция ядра, нормальный pooling | Нужна дисциплина в модулях (не лезть в чужие схемы) |
| Prefix-per-table | Просто | Ноль изоляции по факту |

Для Cloud tier (Tier 3) можно выйти на уровень DB-per-State через
оркестратор, оставив архитектуру кода неизменной.

---

## Правила для плагинов

MUST:

- Все «свои» таблицы создавать только в `dbSchema` текущего модуля.
- Не читать таблицы других модулей — общение только через Event Bus.
- Не обращаться к ядерным таблицам напрямую — только через
  `ModuleContext` (будущий ORM-facade).
- Включать `stateId` в каждую запись, даже если schema уже изолирована
  (defense in depth).

MUST NOT:

- ❌ `CREATE EXTENSION` без явного разрешения Суверена.
- ❌ `pg_dump` / `COPY` изнутри модуля.
- ❌ Кросс-schema FK.

---

## Backup и изоляция

`BackupService` собирает:
1. Ядерные данные State (`state`, `vertical`, `memberships`, `modules`,
   `invitations`) — напрямую.
2. Приватные данные модулей — через опциональный `KrwnModule.exportData()`
   (TODO: добавить в интерфейс когда появится первый модуль с данными).

Ресторе выполняется в обратном порядке: сначала State и Vertical,
потом `InstalledModule` записи, затем — data через `importData()`.
