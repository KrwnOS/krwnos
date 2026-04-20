/**
 * Russian dictionary — source of truth.
 * ------------------------------------------------------------
 * Every translatable string in the UI must have a key here first.
 * Other locales (en.ts, …) mirror this shape; missing keys fall
 * back to the Russian value at runtime.
 *
 * Conventions for keys:
 *   * Dotted path mirrors where the string is used.
 *     `admin.nexus.title`, `chat.sidebar.general`, …
 *   * Shared fragments live under `common.*`.
 *   * Placeholders use `{name}` / `{count}` / etc.
 *   * For plurals, use three variants separated by ` | `:
 *     "{count} узел | {count} узла | {count} узлов"
 *     The order is: one | few | many (Slavic rule).
 *     English uses only the last variant when plural.
 */

import type { Dict } from "../types";

export const ru: Dict = {
  // ------------------------------------------------------------
  // Common primitives (reused everywhere)
  // ------------------------------------------------------------
  "common.loading": "Загрузка…",
  "common.loadingDots": "…",
  "common.refresh": "Обновить",
  "common.save": "Сохранить",
  "common.saving": "Сохраняю…",
  "common.cancel": "Отмена",
  "common.close": "Закрыть",
  "common.closeX": "Закрыть ✕",
  "common.confirm": "Подтвердить",
  "common.sending": "Отправка…",
  "common.submit": "Отправить",
  "common.login": "Войти",
  "common.logout": "Сменить токен",
  "common.error": "Ошибка",
  "common.errorWith": "Ошибка: {message}",
  "common.never": "никогда",
  "common.notSet": "—",
  "common.dash": "—",
  "common.yes": "да",
  "common.no": "нет",
  "common.on": "включено",
  "common.off": "выключено",
  "common.docs": "Docs",
  "common.copy": "копировать",
  "common.copied": "скопировано",
  "common.copyAddress": "Скопировать адрес",
  "common.details": "Подробнее",
  "common.collapse": "Свернуть",
  "common.show": "Показать",
  "common.hide": "Скрыть",

  // ------------------------------------------------------------
  // Root layout / brand
  // ------------------------------------------------------------
  "app.title": "KrwnOS — Community Operating System",
  "app.description":
    "Модульная операционная система для создания цифровых государств, компаний и сообществ.",
  "app.brand": "KrwnOS",
  "language.switcher.label": "Язык",

  // ------------------------------------------------------------
  // Home page (/)
  // ------------------------------------------------------------
  "home.chat.open": "Открыть чат",
  "home.chat.close": "Скрыть чат",
  "home.chat.float": "Чат",
  "home.chat.preparing": "Подготавливаем канал связи…",
  "home.cta.coronate": "Coronate",
  "home.hero.eyebrow": "Community OS",
  "home.hero.titlePre": "Построй своё",
  "home.hero.titleCrown": "цифровое государство.",
  "home.hero.body":
    "KrwnOS — модульная операционная система для создания и управления сообществами, компаниями и кланами. Суверен собирает Вертикаль власти, подключает плагины и раздаёт права вниз по иерархии.",
  "home.hero.createState": "Создать State",
  "home.hero.buildModule": "Разработать модуль",
  "home.pillar.state.title": "The State",
  "home.pillar.state.desc":
    "Изолированный инстанс со своим Сувереном, правилами и набором установленных модулей.",
  "home.pillar.vertical.title": "The Vertical",
  "home.pillar.vertical.desc":
    "Графовая структура власти. Полномочия наследуются и ветвятся сверху вниз.",
  "home.pillar.kernel.title": "The Kernel",
  "home.pillar.kernel.desc":
    "Auth, Permissions, Event Bus и Registry — минимальный набор сервисов ядра.",
  "home.pillar.modules.title": "The Modules",
  "home.pillar.modules.desc":
    "Чат, Казначейство, Задачи, Голосования — плагины, расширяющие государство.",
  "home.footer.mvp": "MVP — Phase 1 Foundation. See",
  "home.footer.roadmap": "ROADMAP",
  "home.sidepanel.label": "Core.Chat",

  // ------------------------------------------------------------
  // Setup wizard (/setup)
  // ------------------------------------------------------------
  "setup.title": "KrwnOS — Коронация",
  "setup.subtitle": "Первый запуск. Создаём ваше государство и Суверена.",
  "setup.done.title": "State создан",
  "setup.done.subtitle": "— ваше цифровое государство живо.",
  "setup.done.shownOnce": "shown once",
  "setup.done.bootstrapToken": "Bootstrap CLI token",
  "setup.done.rotatedToken": "Rotated CLI token",
  "setup.done.replaceHint":
    "Рекомендуется сразу заменить bootstrap-токен — старый будет немедленно отозван.",
  "setup.done.rotate": "Заменить bootstrap-токен",
  "setup.done.rotating": "Ротация…",
  "setup.done.rotated":
    "✓ Прежний bootstrap-токен отозван. Сохраните новый — повторно он не появится.",
  "setup.done.enter": "Войти в государство",
  "setup.form.stateName": "Название государства",
  "setup.form.stateSlug": "URL-slug",
  "setup.form.stateSlugHint": "Оставьте пустым — сгенерируем из названия.",
  "setup.form.stateDesc": "Краткое описание",
  "setup.form.stateDescPh": "Государство сообщества разработчиков…",
  "setup.form.ownerHandle": "Ваш @handle",
  "setup.form.ownerDisplayName": "Отображаемое имя",
  "setup.form.ownerDisplayNamePh": "Red Master",
  "setup.form.ownerEmail": "Email",
  "setup.form.ownerEmailHint":
    "Опционально. Passkey/кошелёк можно подключить позже.",
  "setup.form.submit": "Короновать Суверена",
  "setup.form.submitting": "Коронуем…",

  // Multi-step Coronation wizard
  "setup.nav.back": "← Назад",
  "setup.nav.next": "Далее →",
  "setup.step1.nav": "Государство",
  "setup.step1.title": "Нарекаем государство",
  "setup.step1.desc":
    "С этого шага всё и начнётся. Выберите имя, под которым ваше государство будет известно гражданам — например, «Корпорация X» или «Клан Тени».",
  "setup.step2.nav": "Валюта",
  "setup.step2.title": "Чеканим первую монету",
  "setup.step2.desc":
    "Каждое государство определяет, что считать деньгами. Этот актив (StateAsset) станет национальной валютой по умолчанию — её получает кошелёк каждого нового гражданина.",
  "setup.step2.presets": "Быстрые заготовки",
  "setup.step2.symbol": "Тикер",
  "setup.step2.symbolHint": "2–12 латинских букв/цифр (KRN, GOLD, USD1).",
  "setup.step2.name": "Название валюты",
  "setup.step2.icon": "Глиф",
  "setup.step2.iconHint": "Один-два символа или эмодзи (⚜, ◈, 🪙).",
  "setup.step2.color": "Цвет (#HEX)",
  "setup.step2.decimals": "Знаков после запятой",
  "setup.step2.decimalsHint": "Обычно 18 (ERC-20), 6 (USDC), 9 (Solana).",
  "setup.step2.preview": "Предпросмотр",
  "setup.step3.nav": "Суверен",
  "setup.step3.title": "Венчаем Суверена",
  "setup.step3.desc":
    "Первая учётная запись получает права `[*]` — абсолютный контроль над государством. Позже вы сможете делегировать полномочия «министрам» через Вертикаль.",

  // Done-screen: invite block
  "setup.done.inviteTitle": "Первый magic-link инвайт",
  "setup.done.inviteDesc":
    "Передайте эту ссылку своему первому министру. Приняв её, он сразу войдёт в Sovereign node с унаследованными правами.",
  "setup.done.inviteCode": "Код (QR)",
  "setup.done.inviteExpires": "Истекает",
  "setup.done.inviteNever": "никогда",

  // ------------------------------------------------------------
  // Invite (/invite/[token])
  // ------------------------------------------------------------
  "invite.title": "Приглашение в «{stateName}»",
  "invite.codeLabel": "Код:",
  "invite.uses": "Uses",
  "invite.expires": "Expires",
  "invite.never": "never",
  "invite.expired": "Приглашение истекло",
  "invite.exhausted": "Приглашение исчерпано",
  "invite.unavailable": "Приглашение недоступно",
  "invite.accept": "Принять приглашение",
  "invite.acceptHint": "Подтверждение потребует Passkey или кошелёк.",

  // ------------------------------------------------------------
  // Admin / Nexus (/admin/nexus)
  // ------------------------------------------------------------
  "nexus.eyebrow": "Nexus",
  "nexus.title": "Главная Суверена",
  "nexus.subtitle":
    "Рубка управления государством. Отсюда видно состояние Вертикали, монетарной политики и Палаты Законов. Позже каждый установленный модуль сможет принести сюда свою карточку — Nexus станет настраиваемым рабочим столом.",
  "nexus.errorHint":
    ". Проверьте, что токен выдан Суверену либо держателю глобального права",
  "nexus.loading": "Загружаем состояние государства…",
  "nexus.vertical.eyebrow": "Вертикаль",
  "nexus.vertical.title": "Дерево власти",
  "nexus.vertical.desc":
    "Узлы, должности и ранги — графовая структура, по которой распределяются права.",
  "nexus.vertical.addNode": "Добавить узел",
  "nexus.vertical.openTree": "Открыть дерево",
  "nexus.vertical.nodes": "{count} узел | {count} узла | {count} узлов",
  "nexus.vertical.citizens":
    "{count} гражданин | {count} гражданина | {count} граждан",
  "nexus.vertical.citizensLabel": "Граждан в системе",
  "nexus.vertical.nodesLabel": "Узлов власти",

  // Системный хартбит в шапке дашборда.
  "nexus.status.online": "Online",
  "nexus.status.offline": "Offline",
  "nexus.status.synchronized": "Synchronized",
  "nexus.status.syncing": "Syncing…",
  "nexus.status.uptime": "Uptime {value}",
  "nexus.status.lastSync": "Last sync {value}",

  "nexus.economy.eyebrow": "Экономика",
  "nexus.economy.noCurrency": "Валюта не определена",
  "nexus.economy.desc":
    "Монетарная политика государства: ставки налога и объём циркулирующей валюты.",
  "nexus.economy.stateTax": "Налог (штат)",
  "nexus.economy.stateTaxHint": "Палата Указов",
  "nexus.economy.assetTax": "Налог (актив)",
  "nexus.economy.assetTaxHint": "Фабрика Валют",
  "nexus.economy.supply": "Объём в системе",
  "nexus.economy.openFactory": "Настройки валюты",
  "nexus.economy.openConstitution": "Палата Указов",
  "nexus.economy.mint": "Эмиссия",
  "nexus.economy.mintHint":
    "Напечатать новые {symbol} и зачислить в корневую Казну.",
  "nexus.economy.mintDisabledNoTreasury":
    "Создайте корневой узел Вертикали, чтобы появилась Казна для эмиссии.",
  "nexus.economy.mintDisabledNoAsset":
    "Сначала выпустите первичную валюту в Фабрике Валют.",
  "nexus.economy.mintDisabledCantMint":
    "Для этого актива выключено право эмиссии (`canMint = false`).",

  // Модалка эмиссии (glassmorphism).
  "nexus.mint.title": "Эмиссия {symbol}",
  "nexus.mint.desc":
    "Напечатать новые единицы и зачислить их в корневую Казну. Операция записывается в журнал как {kind}.",
  "nexus.mint.target": "Назначение",
  "nexus.mint.targetTreasury": "Корневая Казна",
  "nexus.mint.amount": "Сумма",
  "nexus.mint.memo": "Памятка (опционально)",
  "nexus.mint.memoPlaceholder": "за что эмиссия",
  "nexus.mint.confirm": "Напечатать",
  "nexus.mint.cancel": "Отмена",
  "nexus.mint.success": "Эмитировано {amount} {symbol}.",
  "nexus.mint.errorAmount": "Сумма должна быть положительным числом.",
  "nexus.mint.errorGeneric": "Не удалось провести эмиссию: {message}",

  // Карточка «Активность».
  "nexus.activity.eyebrow": "Активность",
  "nexus.activity.title": "Последние события",
  "nexus.activity.desc":
    "Пять последних строк Пульса Государства — транзакции, новые граждане, принятые указы.",
  "nexus.activity.empty":
    "Пока тихо — как только модули начнут работать, события прилетят сюда.",
  "nexus.activity.open": "Весь Пульс",
  "nexus.activity.openFeed": "Открыть ленту",
  "nexus.activity.category.wallet": "Казначейство",
  "nexus.activity.category.chat": "Канцелярия",
  "nexus.activity.category.governance": "Палата Законов",
  "nexus.activity.category.state": "Указ",
  "nexus.activity.category.kernel": "Ядро",
  "nexus.activity.category.exchange": "Биржа",
  "nexus.activity.category.other": "Событие",


  "nexus.governance.eyebrow": "Законы",
  "nexus.governance.title": "Последние предложения",
  "nexus.governance.desc":
    "Три последних Proposal из модуля Governance с текущим статусом рассмотрения.",
  "nexus.governance.notInstalled.before": "Модуль",
  "nexus.governance.notInstalled.middle":
    "ещё не установлен. Когда Суверен подключит его через",
  "nexus.governance.notInstalled.after":
    ", здесь появится лента предложений.",
  "nexus.governance.empty":
    "Палата Законов пока пуста — ни одного предложения не внесено.",
  "nexus.governance.open": "Палата Законов",
  "nexus.governance.installHint":
    "Установите модуль governance, чтобы открыть Палату Законов.",
  "nexus.status.draft": "черновик",
  "nexus.status.open": "открыто",
  "nexus.status.passed": "принят",
  "nexus.status.rejected": "отклонён",
  "nexus.status.executed": "исполнен",
  "nexus.status.expired": "истёк",
  "nexus.token.title": "Вход в Nexus",
  "nexus.token.desc.before":
    "Nexus открыт только Суверену государства или держателю глобального права",
  "nexus.token.desc.middle": ". Используйте CLI-токен, выданный командой",
  "nexus.token.desc.after": ".",

  // ------------------------------------------------------------
  // Admin / Vertical Editor (/admin/vertical-editor)
  // ------------------------------------------------------------
  "verticalEditor.eyebrow": "Конструктор Вертикали",
  "verticalEditor.title": "Дерево власти",
  "verticalEditor.subtitle":
    "Соберите вертикаль своего государства визуально. Нажмите «+» под узлом, чтобы создать департамент или должность; перетащите узел на другой, чтобы сменить ему подчинение; выделите узел — справа откроется панель редактирования.",
  "verticalEditor.addRoot": "Корневой узел",
  "verticalEditor.backToNexus": "Nexus",
  "verticalEditor.empty.desc":
    "Вертикаль пуста. Начните с корневого узла — позже от него вырастут министерства и ранги.",
  "verticalEditor.members":
    "{count} человек | {count} человека | {count} человек",
  "verticalEditor.type.position": "Должность",
  "verticalEditor.type.department": "Отдел",
  "verticalEditor.type.rank": "Ранг",
  "verticalEditor.type.lobby": "Прихожая",
  "verticalEditor.node.addChild": "Добавить дочерний узел",
  "verticalEditor.node.memberCount": "Активных членов узла",
  "verticalEditor.node.noPerms": "без явных прав",
  "verticalEditor.node.permCount":
    "{count} право | {count} права | {count} прав",
  "verticalEditor.prompt.childTitle": "Название нового узла",
  "verticalEditor.defaults.childTitle": "Новый узел",
  "verticalEditor.panel.eyebrow": "Редактирование узла",
  "verticalEditor.panel.noneTitle": "Выделите узел",
  "verticalEditor.panel.noneDesc":
    "Кликните по узлу в дереве, чтобы изменить его название, тип или права. «+» под узлом создаёт дочерний, а перетаскивание меняет подчинение.",
  "verticalEditor.panel.title": "Название",
  "verticalEditor.panel.type": "Тип узла",
  "verticalEditor.panel.permissions": "Разрешения (Permissions)",
  "verticalEditor.panel.permsEmpty":
    "Ещё не выдано ни одного права. Добавьте ключ ниже.",
  "verticalEditor.panel.permPlaceholder": "finance.read, chat.write, …",
  "verticalEditor.panel.permHint":
    "Канонический ключ вида «<модуль>.<действие>». Введите и нажмите Enter, чтобы добавить.",
  "verticalEditor.panel.permRemove": "Снять право {key}",
  "verticalEditor.panel.delete": "Удалить узел",
  "verticalEditor.panel.lobbyLocked":
    "Прихожую удалять нельзя — сначала назначьте другого ответственного.",
  "verticalEditor.panel.confirmDelete":
    "Удалить узел «{title}»? Дочерние узлы станут корневыми.",
  "verticalEditor.token.title": "Вход в Конструктор Вертикали",
  "verticalEditor.token.desc.before":
    "Редактирование вертикали доступно только Суверену или держателю",
  "verticalEditor.token.desc.middle":
    ". Используйте CLI-токен, выданный командой",
  "verticalEditor.token.desc.after": ".",
  "verticalEditor.structure.save": "Сохранить структуру",
  "verticalEditor.structure.discard": "Сбросить",
  "verticalEditor.conflict.cycle":
    "Такое подчинение создаст цикл в дереве.",
  "verticalEditor.conflict.lobby":
    "Узел прихожей нельзя переносить под другой узел.",
  "verticalEditor.conflict.generic": "Этот перенос недопустим.",

  // ------------------------------------------------------------
  // Admin / Economy (/admin/economy)
  // ------------------------------------------------------------
  "economy.eyebrow": "Фабрика Валют",
  "economy.title": "Экономика государства",
  "economy.subtitle":
    "Определите национальную валюту, настройте эмиссию, налог штата и публичность. Ровно один актив государства может быть помечен как «флаг» — его и увидят граждане по умолчанию.",
  "economy.errorHint":
    ". Проверьте, что токен выдан с правом {perm} или вы — Суверен.",
  "economy.current": "Текущая валюта:",
  "economy.decimals": "{count} decimals",
  "economy.mintOpen": "эмиссия открыта",
  "economy.mintFrozen": "эмиссия заморожена",
  "economy.tax": "налог {pct}",
  "economy.supplyPublic": "объём публичен",
  "economy.supplyHidden": "объём скрыт",
  "economy.empty": "Валюты ещё не зарегистрированы. Создайте первую ниже.",
  "economy.newHeader": "Новая валюта",
  "economy.token.title": "Вход в экономический контур",
  "economy.token.desc":
    "Для управления валютами нужен CLI-токен Суверена (или лицо с правом {perm}). Сгенерируйте его командой {cmd}.",
  "economy.asset.flag": "Флаг государства",
  "economy.asset.promote": "Установить государственную валюту",
  "economy.asset.current": "Текущая валюта",
  "economy.asset.alreadyPrimary": "Этот актив уже является валютой государства",
  "economy.asset.mint": "Эмиссия",
  "economy.asset.mintHint": "Разрешено ли печатать новые деньги (mint).",
  "economy.asset.mintLocked":
    "Вне-чейн актив: контракт не под нашим контролем.",
  "economy.asset.taxPct": "Налог штата (%)",
  "economy.asset.taxHint":
    "Процент, автоматически удерживаемый в Казну с каждого перевода.",
  "economy.asset.taxNA": "Для ON_CHAIN активов налог не применяется.",
  "economy.asset.public": "Публичность",
  "economy.asset.publicHint":
    "Виден ли общий объём валюты гражданам (и внешним аудиторам).",
  "economy.asset.taxRange": "Налог должен быть в диапазоне 0..100%.",
  "economy.form.name": "Название валюты",
  "economy.form.namePh": "DurovCoin, Empire Gold, USD…",
  "economy.form.symbol": "Тикер (symbol)",
  "economy.form.symbolPh": "KRN",
  "economy.form.type": "Тип",
  "economy.form.type.internal": "INTERNAL — виртуальная",
  "economy.form.type.onchain": "ON_CHAIN — токен в блокчейне",
  "economy.form.mode": "Режим учёта",
  "economy.form.mode.local": "LOCAL — только леджер",
  "economy.form.mode.hybridInternal": "HYBRID — леджер + withdraw",
  "economy.form.mode.external": "EXTERNAL — чистый on-chain",
  "economy.form.mode.hybridOnchain": "HYBRID — с мгновенным учётом",
  "economy.form.network": "Сеть",
  "economy.form.networkPh": "ethereum, polygon, solana…",
  "economy.form.contract": "Адрес контракта",
  "economy.form.contractPh": "0x…",
  "economy.form.taxPct": "Налог штата (%)",
  "economy.form.canMint": "Эмиссия разрешена",
  "economy.form.publicSupply": "Публичный объём",
  "economy.form.isPrimary": "Сразу сделать национальной валютой",
  "economy.form.submit": "Зарегистрировать валюту",
  "economy.form.submitting": "Создаю…",

  // ------------------------------------------------------------
  // Admin / Constitution (/admin/constitution)
  // ------------------------------------------------------------
  "constitution.eyebrow": "Палата Указов",
  "constitution.title": "Конституция государства",
  "constitution.subtitle":
    "Здесь Суверен задаёт правила, по которым живёт песочница: фискальную политику, правила входа, динамику Вертикали. Любое изменение мгновенно применяется к каждому переводу, инвайту и проверке прав.",
  "constitution.errorHint":
    ". Для редактирования требуется CLI-токен Суверена или держателя права {perm}.",
  "constitution.signed": "Указ подписан и вступил в силу.",
  "constitution.loading": "Загружаем конституцию…",
  "constitution.token.title": "Вход в Палату Указов",
  "constitution.token.desc":
    "Редактирование конституции требует CLI-токен Суверена (или держателя права {perm}). Получите его через {cmd}.",

  "citizens.admin.eyebrow": "Граждане",
  "citizens.admin.title": "Граждане",
  "citizens.admin.subtitle":
    "Поиск по членствам, приём из прихожей, перевод между узлами, исключение, бан, слияние дубликатов. Права проверяются на сервере через Permissions Engine.",
  "citizens.admin.token.title": "Вход в зал Граждан",
  "citizens.admin.token.desc":
    "Нужен CLI-токен, привязанный к государству, с правами members.* / invitations.create / system.admin (или статус Суверена). Выпуск: {cmd}.",
  "citizens.admin.filter.node": "Узел",
  "citizens.admin.filter.nodeAll": "Все узлы",
  "citizens.admin.filter.status": "Статус",
  "citizens.admin.filter.statusAll": "Все",
  "citizens.admin.filter.statusActive": "Активные",
  "citizens.admin.filter.statusPending": "Ожидание",
  "citizens.admin.search": "Поиск по @handle / имени",
  "citizens.admin.col.user": "Гражданин",
  "citizens.admin.col.node": "Узел",
  "citizens.admin.col.title": "Титул",
  "citizens.admin.col.status": "Статус",
  "citizens.admin.col.banned": "Бан",
  "citizens.admin.empty": "Нет записей по фильтрам.",
  "citizens.admin.action.kick": "Исключить",
  "citizens.admin.action.ban": "Заблокировать",
  "citizens.admin.action.unban": "Снять бан",
  "citizens.admin.action.move": "Перевести…",
  "citizens.admin.action.admit": "Принять",
  "citizens.admin.action.title": "Титул…",
  "citizens.admin.merge.title": "Слияние дубликатов (Суверен)",
  "citizens.admin.merge.hint":
    "Идемпотентно: если исходного пользователя уже нет — сервер вернёт успех. Объединяет членства и кошельки; исходная учётная запись удаляется.",
  "citizens.admin.merge.source": "Исходный user id (дубликат)",
  "citizens.admin.merge.target": "Целевой user id (оставить)",
  "citizens.admin.merge.run": "Слить",
  "citizens.admin.prompt.moveTo": "Id целевого узла",
  "citizens.admin.prompt.title": "Новый титул (пусто = сбросить)",
  "citizens.admin.prompt.banReason": "Причина бана (необязательно)",
  "citizens.admin.err": "Ошибка запроса",

  "citizen.backToPulse": "Назад к Пульсу",
  "citizen.tokenRequired": "Войдите с CLI-токеном (как на Пульсе), чтобы открыть эту страницу.",
  "citizen.nav.emigrate": "Эмиграция",
  "citizen.nav.roleMarket": "Роль-маркет",
  "citizen.emigration.kicker": "Выход",
  "citizen.emigration.title": "Эмиграция",
  "citizen.emigration.previewTitle": "Предпросмотр возврата",
  "citizen.emigration.previewIntro":
    "Цифры берутся из конституции (`exitRefundRate`) и текущего баланса основного кошелька. Доля в казну без дополнительного налога на транзакции — это конституционный сплит при выходе.",
  "citizen.emigration.rate": "Возврат при выходе (конституция)",
  "citizen.emigration.balance": "Баланс кошелька",
  "citizen.emigration.kept": "Остаётся на вашем кошельке",
  "citizen.emigration.forfeit": "В казну государства",
  "citizen.emigration.effectsTitle": "Что произойдёт",
  "citizen.emigration.effectsBody":
    "Все членства в этом State снимаются. CLI-токены для этого State отзываются — чтобы вернуться, нужна новая регистрация или приглашение. Удержанная сумма остаётся в записи личного кошелька; доступ к приложениям State прекращается вместе с отозванным токеном.",
  "citizen.emigration.sovereignTitle": "Аккаунт Суверена",
  "citizen.emigration.sovereignBody":
    "Владелец State не может эмигрировать этим сценарием. Сначала передайте владение или завершите работу State через операционные инструменты.",
  "citizen.emigration.confirm": "Подтвердить эмиграцию",
  "citizen.emigration.submitting": "Выход…",
  "citizen.emigration.doneTitle": "Вы покинули государство",
  "citizen.emigration.doneBody":
    "Членства сняты, привязанные к State токены отозваны. Если на кошельке остался баланс, он разделён так, как было показано до подтверждения.",
  "citizen.emigration.home": "На главную",
  "citizen.roleMarket.kicker": "Маркет",
  "citizen.roleMarket.title": "Роль-маркет",
  "citizen.roleMarket.sovereignTitle": "Недоступно Суверену",
  "citizen.roleMarket.sovereignBody":
    "Владелец State назначает роли через Вертикаль / граждан — самообслуживание для гостей в Прихожей.",
  "citizen.roleMarket.offTitle": "Покупка отключена",
  "citizen.roleMarket.offBody":
    "Конституция не включила выкуп ролей (`rolesPurchasable`). Изменить это могут предложения в Парламенте, если правила это допускают.",
  "citizen.roleMarket.priceTitle": "Цена",
  "citizen.roleMarket.priceBody":
    "Плата — это взнос за гражданство из конституции: {amount} {currency} за покупку (зачисляется в казну выбранного узла).",
  "citizen.roleMarket.yourBalance": "Ваш баланс: {amount} {currency}",
  "citizen.roleMarket.nodesTitle": "Узлы для вступления",
  "citizen.roleMarket.nodesHint":
    "Нужно быть в Прихожей без другой активной роли. Оплата по тем же правилам, что и платное принятие приглашения.",
  "citizen.roleMarket.noNodes": "Пока нет узлов кроме Прихожей.",
  "citizen.roleMarket.buy": "Купить",
  "citizen.roleMarket.purchased": "Готово",
  "citizen.roleMarket.notLobbyOnly":
    "У вас уже есть активная роль вне Прихожей. Перевод — через управление или офицера; рынок только для пути из Прихожей.",

  "constitution.dirty": "Есть несохранённые изменения",
  "constitution.clean": "Все поля синхронизированы с БД",
  "constitution.sign": "Подписать указ",
  "constitution.signing": "Подписываю…",
  "constitution.signHint": "Измените любое поле, чтобы подписать указ",
  "constitution.ch1.eyebrow": "Глава I",
  "constitution.ch1.title": "Фискальная политика",
  "constitution.ch1.desc":
    "Три налоговых слоя. Налог на транзакции применяется к любому переводу между гражданами. Подоходный — к выплатам из казны на личный кошелёк. Налог на роль хранится как декларация: его автоматически спишет cron-механика более поздних релизов.",
  "constitution.ch1.transferTax": "Налог на перевод (%)",
  "constitution.ch1.transferTaxHint":
    "С каждой P2P-операции уходит в корневую Казну.",
  "constitution.ch1.incomeTax": "Подоходный налог (%)",
  "constitution.ch1.incomeTaxHint":
    "С начислений из казны на личный кошелёк.",
  "constitution.ch1.roleTax": "Налог на роль (%/мес)",
  "constitution.ch1.roleTaxHint":
    "Месячная подписка на удержание высокой позиции.",
  "constitution.ch1.display": "Витрина названия валюты",
  "constitution.ch1.displayHint":
    "Необязательная подпись для UI. Настоящая единица учёта остаётся в Фабрике Валют (тикер первичного актива).",
  "constitution.ch1.displayPh": "Королевская Крона",
  "constitution.ch2.eyebrow": "Глава II",
  "constitution.ch2.title": "Правила входа и выхода",
  "constitution.ch2.desc":
    "Плата за гражданство защищает от спама. Выкуп ролей позволяет превратить Вертикаль в биржу статусов. Возврат при выходе определяет, считается ли эмиграция легитимной.",
  "constitution.ch2.citizenship": "Плата за гражданство",
  "constitution.ch2.citizenshipHint":
    "В единицах первичной валюты. 0 = бесплатный вход.",
  "constitution.ch2.exitRefund": "Возврат при выходе (%)",
  "constitution.ch2.exitRefundHint": "Доля остатка, возвращаемая эмигранту.",
  "constitution.ch2.rolesPurchasable": "Выкуп ролей разрешён",
  "constitution.ch2.rolesPurchasableHint":
    "Позволяет выставить узел Вертикали на продажу.",
  "constitution.ch3.eyebrow": "Глава III",
  "constitution.ch3.title": "Динамика Вертикали",
  "constitution.ch3.desc":
    "Определяет, как власть и прозрачность распределяются «сами собой». Наследование прав превращает министров в видящих всё в подразделении. Авто-продвижение назначает гражданину новую должность при выполнении условий.",
  "constitution.ch3.inheritance": "Наследование прав",
  "constitution.ch3.inheritanceHint":
    "Министр видит всё, что видят его подчинённые.",
  "constitution.ch3.autoPromo": "Авто-продвижение",
  "constitution.ch3.autoPromoHint":
    "Автоматически переводит гражданина в целевой узел.",
  "constitution.ch3.treasury": "Прозрачность казны",
  "constitution.ch3.treasuryHint": "Кто видит TreasuryWallet и его историю.",
  "constitution.ch3.treasury.public": "Публичная — все граждане",
  "constitution.ch3.treasury.council": "Совет — узел и предки",
  "constitution.ch3.treasury.sovereign": "Только Суверен",
  "constitution.ch3.promoBalance": "Порог баланса",
  "constitution.ch3.promoBalanceHint": "Минимум средств для авто-повышения.",
  "constitution.ch3.promoDays": "Стаж, дней",
  "constitution.ch3.promoDaysHint":
    "Сколько дней в системе должен провести гражданин.",
  "constitution.ch3.promoTarget": "Целевой узел (id)",
  "constitution.ch3.promoTargetHint":
    "cuid узла Вертикали. Возьмите из /admin/vertical.",
  "constitution.ch4.eyebrow": "Глава IV",
  "constitution.ch4.title": "Парламент",
  "constitution.ch4.desc":
    "Включает или отключает прямую демократию. В режиме «Указ» предложения граждан остаются декларациями. В «Консультации» Суверен видит итоги и принимает решение вручную. В «Авто-DAO» успешные голосования меняют конституцию сами — но право вето Суверена по-прежнему доступно, если не выключено.",
  "constitution.ch4.mode": "Режим управления",
  "constitution.ch4.modeHint":
    "Определяет, влияют ли голоса граждан на state settings.",
  "constitution.ch4.mode.decree": "Указ — только Суверен",
  "constitution.ch4.mode.consultation": "Консультация — вручную",
  "constitution.ch4.mode.auto": "Auto-DAO — автоматически",
  "constitution.ch4.veto": "Право вето Суверена",
  "constitution.ch4.vetoHint":
    "Разрешает Суверену наложить вето на любое решение.",
  "constitution.ch4.weight": "Вес голоса",
  "constitution.ch4.weightHint":
    "Как система считает вклад каждого голосующего.",
  "constitution.ch4.weight.person": "Один человек — один голос",
  "constitution.ch4.weight.node": "По весу узла Вертикали",
  "constitution.ch4.weight.balance": "По балансу первичного актива",
  "constitution.ch4.quorum": "Кворум (%)",
  "constitution.ch4.quorumHint":
    "Минимальная доля электората, подавшая голос.",
  "constitution.ch4.threshold": "Порог «за» (%)",
  "constitution.ch4.thresholdHint":
    "Доля «за» от общего числа поданных голосов.",
  "constitution.ch4.duration": "Длительность, дни",
  "constitution.ch4.durationHint":
    "Сколько длится голосование от создания до автозакрытия.",
  "constitution.ch4.minBalance": "Мин. баланс для создания предложения",
  "constitution.ch4.minBalanceHint":
    "Anti-spam: сколько первичной валюты нужно иметь. Пусто = не ограничивать.",
  "constitution.ch4.allowedTitle": "Параметры, отдаваемые Парламенту",
  "constitution.ch4.allowedDesc":
    "Отмеченные ключи граждане смогут предложить изменить через {link}. Снимите все галочки, чтобы оставить Парламент декоративным.",
  "constitution.ch4.allowedLink": "Парламент",
  "constitution.keys.transactionTaxRate": "Налог на перевод",
  "constitution.keys.incomeTaxRate": "Подоходный налог",
  "constitution.keys.roleTaxRate": "Налог на роль",
  "constitution.keys.currencyDisplayName": "Витрина валюты",
  "constitution.keys.citizenshipFeeAmount": "Плата за гражданство",
  "constitution.keys.rolesPurchasable": "Выкуп ролей",
  "constitution.keys.exitRefundRate": "Возврат при выходе",
  "constitution.keys.permissionInheritance": "Наследование прав",
  "constitution.keys.autoPromotionEnabled": "Авто-продвижение: вкл.",
  "constitution.keys.autoPromotionMinBalance": "Авто-продвижение: баланс",
  "constitution.keys.autoPromotionMinDays": "Авто-продвижение: стаж",
  "constitution.keys.autoPromotionTargetNodeId": "Авто-продвижение: узел",
  "constitution.keys.treasuryTransparency": "Прозрачность казны",

  // ------------------------------------------------------------
  // Styling Hub — Визуальный конструктор (/admin/styling)
  // ------------------------------------------------------------
  "styling.eyebrow": "Визуальный конструктор",
  "styling.title": "Облик государства",
  "styling.subtitle":
    "Настройте Theme Engine: цвета, шрифты, скругления и эффекты. Любое изменение мгновенно разносится по всей ОС — от кошелька до чата.",
  "styling.saved": "Тема сохранена и применена ко всему государству.",
  "styling.dirty": "Есть несохранённые изменения",
  "styling.clean": "Тема синхронизирована с БД",
  "styling.save": "Подписать указ о стиле",
  "styling.saving": "Сохраняю…",
  "styling.revert": "Отменить правки",
  "styling.reset": "Сбросить к Minimalist High-Tech",
  "styling.resetHint":
    "Мгновенный live-rollback к эталонной теме KrwnOS (живые стили, БД не трогаем).",
  "styling.errorHint":
    "Проверьте, что у вашего CLI-токена есть permission «{perm}» или вы — Суверен.",
  "styling.token.title": "Вход в Визуальный конструктор",
  "styling.token.desc":
    "Нужен CLI-токен с permission «{perm}». Его выдаёт Суверен через `krwn token mint`.",

  "styling.presets.eyebrow": "Галерея",
  "styling.presets.title": "Пресеты темы",
  "styling.presets.desc":
    "Выберите отправную точку. Дальше — ручная доводка токенов.",
  "styling.presets.customNotice":
    "Вы отредактировали пресет — тема помечена как «custom». Сохранение зафиксирует её в БД под этим именем.",
  "styling.presets.minimal-hightech.label": "Minimalist High-Tech",
  "styling.presets.minimal-hightech.desc":
    "Финтех-строгость: чёрный фон, золотой акцент, Inter.",
  "styling.presets.terminal.label": "Terminal",
  "styling.presets.terminal.desc":
    "Зелёный CRT, моноширинный шрифт, нулевые радиусы.",
  "styling.presets.glass.label": "Glassmorphism",
  "styling.presets.glass.desc":
    "Светлая полупрозрачная эстетика macOS с мягкими радиусами.",
  "styling.presets.royal-gold.label": "Royal Gold",
  "styling.presets.royal-gold.desc":
    "Тёмно-пурпур + золото, парадный Cormorant Garamond.",
  "styling.presets.cyberpunk.label": "Cyberpunk",
  "styling.presets.cyberpunk.desc":
    "Неон-розовый и циан, Orbitron, свечение для игровых кланов.",

  "styling.palette.eyebrow": "Палитра",
  "styling.palette.title": "Цветовые токены",
  "styling.palette.desc":
    "Все переменные `--*` — выдаются как HSL для Tailwind и как hex для прямых CSS-свойств.",
  "styling.palette.background": "Фон",
  "styling.palette.foreground": "Текст",
  "styling.palette.card": "Карточки / панели",
  "styling.palette.muted": "Подложки",
  "styling.palette.border": "Границы",
  "styling.palette.accent": "Акцент",
  "styling.palette.primary": "Primary",
  "styling.palette.destructive": "Destructive",

  "styling.typography.eyebrow": "Типографика",
  "styling.typography.title": "Шрифты интерфейса",
  "styling.typography.desc":
    "Сменится во всех модулях одновременно — в чате, кошельке, админке.",
  "styling.typography.sans": "Основной",
  "styling.typography.mono": "Моноширинный",
  "styling.typography.display": "Парадный (display)",
  "styling.typography.displayHint":
    "Необязательный — используется для крупных заголовков. Пусто = отключено.",

  "styling.shape.eyebrow": "Форма",
  "styling.shape.title": "Скругления и эффекты",
  "styling.shape.desc":
    "Live-слайдеры: интерфейс перекрашивается прямо в момент перетаскивания.",
  "styling.shape.radiusSm": "Радиус — малый",
  "styling.shape.radiusMd": "Радиус — средний",
  "styling.shape.radiusLg": "Радиус — крупный",
  "styling.shape.blur": "Размытие (glass)",

  "styling.preview.eyebrow": "Предпросмотр",
  "styling.preview.title": "Живая витрина",
  "styling.preview.desc":
    "Так ваши граждане увидят интерфейс прямо сейчас — без перезагрузки страницы.",
  "styling.preview.primary": "Подписать",
  "styling.preview.outline": "Обсудить",
  "styling.preview.ghost": "Отмена",
  "styling.preview.badge": "online",
  "styling.preview.cardTitle": "Карточка модуля",
  "styling.preview.cardDesc":
    "Пример текста под новым шрифтом с новыми цветами и радиусами.",
  "styling.preview.inputPh": "Введите сумму…",
  "styling.preview.submit": "Отправить",
  "styling.preview.walletEyebrow": "Личный кошелёк",

  "styling.custom.eyebrow": "Custom CSS",
  "styling.custom.title": "Раздел для продвинутых",
  "styling.custom.desc":
    "Сырой CSS, который будет вставлен после всех токенов в `<style id=\"krwn-theme\">`. Используйте `var(--primary-hex)`, `var(--radius)`, `var(--font-mono)` и т.д.",
  "styling.custom.hint":
    "Лимит — 16 КБ. Теги </style> и <script> вырезаются на сервере.",

  // ------------------------------------------------------------
  // Governance (/governance)
  // ------------------------------------------------------------
  "governance.eyebrow": "Парламент",
  "governance.title": "Ассамблея предложений",
  "governance.subtitle":
    "Здесь граждане предлагают изменения к конституции. Режим голосования выбирает Суверен — Парламент может быть чисто совещательным, а может автоматически менять правила государства по решению большинства.",
  "governance.filter.active": "Активные",
  "governance.filter.closed": "Завершённые",
  "governance.filter.all": "Все",
  "governance.empty.active":
    "Все голосования закрыты — или никто ещё не внёс ни одного предложения.",
  "governance.empty.other": "Попробуйте другой фильтр.",
  "governance.empty.prefix": "Предложений не найдено.",
  "governance.flash.created": "Предложение опубликовано.",
  "governance.flash.voted": "Голос учтён.",
  "governance.flash.executed": "Решение применено.",
  "governance.flash.vetoed": "Предложение получило вето.",
  "governance.status.active": "Идёт голосование",
  "governance.status.passed": "Принято",
  "governance.status.rejected": "Отклонено",
  "governance.status.executed": "Исполнено",
  "governance.status.vetoed": "Вето",
  "governance.status.cancelled": "Отозвано",
  "governance.status.expired": "Истёк срок",
  "governance.mode.decree": "Указ — меняет только Суверен",
  "governance.mode.consultation": "Консультация — голос совещательный",
  "governance.mode.auto":
    "Auto-DAO — успешное решение применяется автоматически",
  "governance.mode.short.decree": "указ",
  "governance.mode.short.consultation": "консультация",
  "governance.mode.short.auto": "auto-DAO",
  "governance.rules.title": "Правила Парламента",
  "governance.rules.desc":
    "Снимок «конституции самого голосования». Редактируется только Сувереном через {link}.",
  "governance.rules.link": "Палату Указов",
  "governance.rules.mode": "Режим",
  "governance.rules.quorum": "Кворум",
  "governance.rules.quorumValue": "{pct}% от электората",
  "governance.rules.threshold": "Порог принятия",
  "governance.rules.thresholdValue": "{pct}% «за»",
  "governance.rules.duration": "Длительность",
  "governance.rules.weight": "Стратегия веса",
  "governance.rules.weight.person": "один человек — один голос",
  "governance.rules.weight.node": "по весу узла",
  "governance.rules.weight.balance": "по балансу кошелька",
  "governance.rules.veto": "Право вето Суверена",
  "governance.rules.allowed": "Разрешённые к изменению ключи",
  "governance.rules.allowedEmpty":
    "Суверен пока не отдал ни одного параметра на откуп. Подавать предложения невозможно.",
  "governance.create.title": "Новое предложение",
  "governance.create.desc":
    "Выберите ключ из whitelist-а Суверена и предложите его новое значение. Значение автоматически конвертируется в правильный тип (число / bool / строка / null) — шпаргалка рядом с полем.",
  "governance.create.name": "Название",
  "governance.create.namePh": "Снизить налог на перевод до 1%",
  "governance.create.why": "Обоснование",
  "governance.create.whyPh": "Почему это стоит принять. Какие риски.",
  "governance.create.key": "Параметр конституции",
  "governance.create.value": "Новое значение",
  "governance.create.submit": "Опубликовать",
  "governance.create.submitting": "Публикую…",
  "governance.create.disabledByDecree":
    "Текущий режим — «Указ». Предложения граждан отключены.",
  "governance.proposal.vote.for": "За",
  "governance.proposal.vote.against": "Против",
  "governance.proposal.vote.abstain": "Воздержаться",
  "governance.proposal.veto": "Наложить вето",
  "governance.proposal.applyExecute": "Применить решение",
  "governance.proposal.vetoShort": "Вето",
  "governance.proposal.count.for": "За",
  "governance.proposal.count.against": "Против",
  "governance.proposal.count.abstain": "Воздержались",
  "governance.proposal.count.votes": "Голосов",
  "governance.proposal.tally.quorum": "Кворум",
  "governance.proposal.tally.quorumReached":
    "достигнут ({cast}/{total})",
  "governance.proposal.tally.threshold": "Порог",
  "governance.proposal.tally.thresholdPassed": "пройден",
  "governance.proposal.tally.thresholdFailed": "не пройден",
  "governance.proposal.tally.forecast": "Прогноз",
  "governance.proposal.tally.willPass": "будет принято",
  "governance.proposal.tally.willReject": "будет отклонено",
  "governance.proposal.tally.expires": "Истекает",
  "governance.proposal.vetoReason": "Причина вето: {reason}",
  "governance.proposal.votesHeader": "Голоса ({count})",
  "governance.proposal.vote.short.for": "за",
  "governance.proposal.vote.short.against": "против",
  "governance.token.title": "Вход в Парламент",
  "governance.token.desc":
    "Голосование и подача предложений требуют CLI-токен гражданина. Получите его через {cmd}.",
  "governance.hint.rate": "Например: 0.05 (=5%). Диапазон 0..1.",
  "governance.hint.amount": "Целое или дробное число ≥ 0. Пусто → null.",
  "governance.hint.bool": "true или false",
  "governance.hint.transparency": "public | council | sovereign",
  "governance.hint.string": "Строка (пусто → null)",
  "governance.hint.jsonFallback": "JSON-совместимое значение",
  "governance.coerce.numberNeeded": "Ожидается число.",
  "governance.coerce.nonNeg": "Ожидается число ≥ 0.",
  "governance.coerce.intNonNeg": "Ожидается целое ≥ 0.",
  "governance.coerce.bool": "Ожидается true или false.",
  "governance.coerce.transparency": "public | council | sovereign",

  // ------------------------------------------------------------
  // Wallet (modules/wallet + components/wallet)
  // ------------------------------------------------------------
  "wallet.offline": "Wallet offline",
  "wallet.none": "Нет кошелька",
  "wallet.my": "Моя казна",
  "wallet.personalBalance": "Личный кошелёк",
  "wallet.treasury": "Казна узла",
  "wallet.transfer": "Перевести",
  "wallet.transferTitle": "Перевод Крон",
  "wallet.transferDesc":
    "Отправьте Кроны с личного счёта или с бюджета отдела.",
  "wallet.openTransfer": "Открыть перевод",
  "wallet.noOperations": "Операций пока нет.",
  "wallet.lastTransactions": "Последние транзакции",
  "wallet.source": "Источник",
  "wallet.source.personal": "Личный счёт",
  "wallet.source.personalModal": "Личные средства",
  "wallet.source.balance": "Баланс: {amount}",
  "wallet.source.budget": "Бюджет: {amount}",
  "wallet.source.treasury": "Казна: {amount}",
  "wallet.source.noTreasuries.prefix": "Бюджеты отделов недоступны — нужна роль с правом",
  "wallet.source.noTreasuries.suffix": ".",
  "wallet.personalOnly.prefix": "Перевод со своего личного кошелька. Баланс:",
  "wallet.recipient": "Получатель",
  "wallet.recipient.user": "Пользователь",
  "wallet.recipient.userModal": "Пользователь (userId)",
  "wallet.recipient.treasury": "Казна",
  "wallet.recipient.treasuryModal": "Казна (nodeId)",
  "wallet.recipient.walletId": "Wallet ID",
  "wallet.amount": "Сумма (⚜)",
  "wallet.memo": "Memo (за что)",
  "wallet.memoPh": "Зарплата за апрель",
  "wallet.err.amount":
    "Введите корректную сумму (например, 100 или 100.50).",
  "wallet.err.amountModal":
    "Введите корректную сумму (формат: 100 или 100.50).",
  "wallet.err.insufficient": "Недостаточно средств на выбранном кошельке.",
  "wallet.err.noRecipient": "Укажите получателя.",
  "wallet.err.serverStatus": "Сервер вернул {status}",
  "wallet.treasuryLabel": "Казна · {id}",
  "wallet.type.personal": "Personal",
  "wallet.type.treasury": "Treasury",
  "wallet.type.personalUpper": "PERSONAL",
  "wallet.type.treasuryUpper": "TREASURY",
  "wallet.tx.status.failed": "отклонено",
  "wallet.tx.status.pending": "в обработке",
  "wallet.tx.status.reversed": "отменено",
  "wallet.tx.mint.in": "Эмиссия (приход)",
  "wallet.tx.mint": "Эмиссия",
  "wallet.tx.burn": "Burn",
  "wallet.tx.treasuryFrom": "Перевод из казны",
  "wallet.tx.treasuryOp": "Казначейская операция",
  "wallet.tx.transferIn": "Входящий перевод",
  "wallet.tx.transferOut": "Исходящий перевод",

  // ------------------------------------------------------------
  // Chat (modules/chat)
  // ------------------------------------------------------------
  "chat.connect.title": "Подключение к чату",
  "chat.connect.desc":
    "Вставьте CLI-токен с scope'ами {read}, {write} (и опционально {admin}). Его можно сгенерировать командой {cmd}.",
  "chat.connect.submit": "Войти в канал",
  "chat.connect.noToken": "Ещё не короновали Государство?",
  "chat.connect.goSetup": "Открыть визард коронации →",
  "chat.apiErr": "Ошибка API ({status}): {message}",
  "chat.empty": "Выберите канал слева — или создайте новый через `chat.admin`.",
  "chat.noMessages": "Пока сообщений нет. Будьте первым.",
  "chat.sidebar.channels": "Каналы",
  "chat.sidebar.general": "Общие",
  "chat.sidebar.generalEmpty": "Публичных каналов нет",
  "chat.sidebar.department": "Мой отдел",
  "chat.sidebar.departmentEmpty": "Вас ещё не назначили в узел",
  "chat.sidebar.direct": "Прямые связи",
  "chat.sidebar.directEmpty": "Нет подчинённых узлов",
  "chat.sidebar.other": "Иное",
  "chat.sidebar.canDirective": "Вы можете издавать приказы в этот канал",
  "chat.access.sovereign": "Суверен",
  "chat.access.direct": "Мой отдел",
  "chat.access.inherited": "Надзор",
  "chat.access.general": "Общий",
  "chat.sender.you": "вы",
  "chat.ack.required": "Требуется подтверждение выполнения.",
  "chat.ack.submit": "Принято к исполнению",
  "chat.ack.submitting": "...",
  "chat.composer.sendMessage":
    "Сообщение в #{title}… (Markdown поддерживается)",
  "chat.composer.sendDirective":
    "Приказ в #{title}… (Markdown поддерживается)",
  "chat.composer.sendAsDirective": "Отправить как Приказ",
  "chat.composer.send": "Отправить",
  "chat.composer.issueDirective": "Издать приказ",
  "chat.composer.errSend": "send failed",
  "chat.directive.ack": "Принято",
  "chat.directive.badge": "Приказ",
  "chat.directive.ackedAria": "Приказ выполнен",
  "chat.directive.badgeAria": "Системный приказ",
  "chat.tray.items":
    "У вас {count} {word} без подтверждения.",
  "chat.tray.word": "приказ | приказа | приказов",

  // ------------------------------------------------------------
  // Dashboard / State Pulse (/dashboard)
  // ------------------------------------------------------------
  "pulse.eyebrow": "Пульс Государства",
  "pulse.title": "Что происходит",
  "pulse.subtitle":
    "Агрегированная лента событий всех модулей: законы, указы, бюджеты, приказы.",
  "pulse.filter.all": "Все",
  "pulse.filter.wallet": "Казна",
  "pulse.filter.chat": "Чат",
  "pulse.filter.governance": "Парламент",
  "pulse.filter.state": "Указы",
  "pulse.filter.kernel": "Ядро",
  "pulse.live.connected": "Онлайн",
  "pulse.live.offline": "Офлайн",
  "pulse.empty.title": "В эфире тихо",
  "pulse.empty.body":
    "Как только в государстве что-то произойдёт — это появится здесь.",
  "pulse.loadMore": "Показать ещё",
  "pulse.noMore": "Это начало истории государства.",
  "pulse.viewer.citizen": "Гражданин",
  "pulse.viewer.sovereign": "Суверен",
  "pulse.token.title": "Войти в Пульс Государства",
  "pulse.token.desc":
    "Вставьте CLI-токен, выданный командой `{cmd}`. Токен хранится только в этом браузере.",

  // --- Role card (header) ---
  "pulse.role.sovereign": "Суверен",
  "pulse.role.lobby": "Прихожая",
  "pulse.role.none": "Без роли",
  "pulse.role.noneHint":
    "Суверен ещё не принял вас в Вертикаль — ждите приглашения.",
  "pulse.role.pathLabel": "Путь по Вертикали",

  // --- Balance card (header) ---
  "pulse.balance.label": "Баланс",
  "pulse.balance.none": "Кошелёк не выдан",

  // --- Sidebar (дерево власти + онлайн) ---
  "pulse.sidebar.title": "Вертикаль власти",
  "pulse.sidebar.emptyTree":
    "Государство ещё не построено. Создайте первый узел в редакторе Вертикали.",
  "pulse.sidebar.onlineTotal":
    "Онлайн: {count} | Онлайн: {count} | Онлайн: {count}",
  "pulse.sidebar.footnote":
    "Онлайн — активность за последние {seconds} с.",

  "pulse.event.wallet.transfer":
    "Перевод {amount} {currency}",
  "pulse.event.wallet.treasury_allocation":
    "Казна выплатила {amount} {currency}",
  "pulse.event.wallet.mint":
    "Эмиссия: {amount} {currency} вошли в обращение",
  "pulse.event.wallet.burn":
    "Сожжено {amount} {currency}",
  "pulse.event.chat.channel_created": "Создан новый канал",
  "pulse.event.chat.directive": "Новый приказ: «{body}»",
  "pulse.event.governance.proposal_created":
    "Новое предложение: изменить «{key}»",
  "pulse.event.governance.proposal_passed":
    "Голосование закрыто: закон принят",
  "pulse.event.governance.proposal_rejected":
    "Голосование закрыто: закон отклонён",
  "pulse.event.governance.proposal_expired":
    "Голосование истекло без решения",
  "pulse.event.governance.proposal_executed":
    "Закон вступил в силу: {key} → {value}",
  "pulse.event.governance.proposal_vetoed":
    "Суверен наложил вето",
  "pulse.event.state.settings_updated":
    "Конституция государства обновлена",
  "pulse.event.kernel.state_created":
    "Государство основано",
  "pulse.event.kernel.membership_granted":
    "Новое членство в узле Вертикали",
  "pulse.event.kernel.membership_revoked":
    "Членство в узле Вертикали снято",
  "pulse.event.kernel.membership_moved": "Гражданин переведён между узлами",
  "pulse.event.kernel.user_banned": "Гражданин заблокирован в государстве",
  "pulse.event.kernel.user_unbanned": "Блокировка снята — можно вернуться",
  "pulse.event.kernel.users_merged": "Дубликаты учётных записей объединены Сувереном",

  // --- Broadcast (Суверенский указ) ---
  "pulse.broadcast.trigger": "Огласить указ",
  "pulse.broadcast.title": "Суверенский указ",
  "pulse.broadcast.subtitle":
    "Сообщение появится у всех граждан государства: в ленте, в тосте и в системном уведомлении браузера.",
  "pulse.broadcast.headline": "Заголовок",
  "pulse.broadcast.headlinePh": "Государь обращается к Вертикали",
  "pulse.broadcast.body": "Текст",
  "pulse.broadcast.bodyPh":
    "Опциональное тело указа. Markdown не поддерживается.",
  "pulse.broadcast.publish": "Огласить",
  "pulse.broadcast.errTitleRequired": "Заголовок обязателен.",

  // --- Push-тосты ---
  "pulse.toast.eyebrow": "Указ Суверена",
  "pulse.toast.defaultTitle": "Новое событие",

  // --- Node detail drawer ---
  "pulse.sidebar.onlineCount": "{online} из {total} онлайн",
  "pulse.sidebar.you": "вы",
  "pulse.nodeType.position": "Должность",
  "pulse.nodeType.department": "Департамент",
  "pulse.nodeType.rank": "Ранг",
  "pulse.drawer.members": "Участники",
  "pulse.drawer.membersEmpty": "Узел пуст.",
  "pulse.drawer.children": "Подчинённые узлы",
  "pulse.drawer.childrenEmpty": "Нет подчинённых узлов.",
  "pulse.drawer.edit": "Редактировать узел",
  "pulse.drawer.openChat": "Открыть канал",

  // --- Header actions ---
  "pulse.header.audit": "Журнал аудита",

  // ------------------------------------------------------------
  // /admin/audit — Audit Log
  // ------------------------------------------------------------
  "audit.eyebrow": "Журнал аудита",
  "audit.title": "Полная история государства",
  "audit.subtitle":
    "Сырые события из Пульса без фильтра видимости. Только для Суверена и держателей system.admin.",
  "audit.backToPulse": "Назад в Пульс",
  "audit.forbidden.title": "Доступ ограничен",
  "audit.forbidden.body":
    "Журнал аудита доступен только Суверену и держателям system.admin.",
  "audit.forbidden.back": "На главную",
  "audit.filter.category": "Категория",
  "audit.filter.event": "Событие",
  "audit.filter.actor": "Инициатор",
  "audit.filter.actorPlaceholder": "@handle или cuid",
  "audit.empty.title": "Ничего не найдено",
  "audit.empty.body":
    "Попробуйте смягчить фильтры — возможно, таких событий ещё не было.",
  "audit.col.when": "Когда",
  "audit.col.category": "Категория",
  "audit.col.event": "Событие",
  "audit.col.actor": "Инициатор",
  "audit.col.title": "Описание",
  "audit.col.visibility": "Видимость",
  "audit.actor.system": "система",
  "audit.retention.unlimited":
    "Ретенция событий: без ограничения (KRWN_ACTIVITY_LOG_RETENTION_DAYS=0). Фоновая задача не удаляет старые строки.",
  "audit.retention.policy":
    "Ретенция: на сервере хранятся события не старше {days} суток (переменная KRWN_ACTIVITY_LOG_RETENTION_DAYS, по умолчанию 365). Более старые строки удаляет задача activity-log-reaper.",
  "audit.export.legendTitle": "Семантика колонок CSV",
  "audit.export.col.id": "id — стабильный идентификатор строки (cuid).",
  "audit.export.col.createdAt":
    "createdAt — метка времени UTC в ISO-8601, когда событие записано.",
  "audit.export.col.category":
    "category — группа для UI (wallet, chat, governance, …).",
  "audit.export.col.event":
    "event — каноническое имя на шине (напр. core.wallet.transaction.created).",
  "audit.export.col.actorId":
    "actorId — id пользователя-инициатора; пусто для системных задач.",
  "audit.export.col.actorHandle":
    "actorHandle — handle из снимка членства Пульса на момент экспорта (может быть пустым).",
  "audit.export.col.nodeId":
    "nodeId — узел Вертикали, к которому привязано событие, если есть.",
  "audit.export.col.visibility":
    "visibility — public | node | audience | sovereign (кто видел бы событие в Пульсе без режима аудита).",
  "audit.export.col.titleKey":
    "titleKey — ключ i18n для заголовка (в БД не локализуется).",
  "audit.export.col.titleRendered":
    "titleRendered — заголовок на текущей локали UI в момент экспорта.",
  "audit.export.col.titleParamsJson":
    "titleParamsJson — JSON параметров для интерполяции titleKey.",
  "audit.export.col.metadataJson":
    "metadataJson — JSON контекста (модульные поля, id, суммы).",
  "audit.export.col.audienceUserIds":
    "audienceUserIds — список user id через «|» для visibility=audience.",
  "audit.export.cap":
    "В выгрузку попадают все строки по текущим фильтрам, не более {max}.",
  "audit.footnote":
    "Экспорт JSON/CSV использует те же фильтры, что и таблица, и серверное окно ретенции.",

  // --- Broadcast as an Activity entry title ---
  "pulse.event.broadcast.sovereign": "Указ Суверена: {title}",
};
