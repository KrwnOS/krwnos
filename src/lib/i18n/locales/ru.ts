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
};
