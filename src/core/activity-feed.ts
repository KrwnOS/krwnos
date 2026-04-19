/**
 * ActivityFeedService — Пульс Государства.
 * ------------------------------------------------------------
 * Агрегированная лента событий, которую видит гражданин на
 * главной странице (`/dashboard`). Сервис делает три вещи:
 *
 *   1. Пишет события в таблицу `ActivityLog` (`record()`).
 *   2. Отдаёт отфильтрованную ленту конкретному пользователю
 *      (`listForViewer()`) — «только то, что касается его или
 *      его узла власти».
 *   3. Подписывается на канонические события модулей через
 *      Event Bus (`subscribeActivityFeed()`) и переводит их в
 *      строки `ActivityLog` (wallet/chat/governance/state).
 *
 * Сервис — framework-agnostic: Prisma/Redis не упоминаются.
 * Подключение к реальной БД — через `ActivityRepository`
 * (см. `src/core/activity-feed-prisma.ts`).
 *
 * Модель видимости:
 *   * `public`    — все граждане State.
 *   * `node`      — члены `nodeId` + все предки.
 *   * `audience`  — только `audienceUserIds`.
 *   * `sovereign` — только Суверен.
 *
 * Суверен видит всё вне зависимости от `visibility`.
 */

import type { ModuleEventBus } from "@/types/kernel";
import { Decimal } from "@prisma/client/runtime/library";
import { KernelEvents } from "./event-bus";

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

/**
 * Широкий каталог категорий ленты — управляется UI (табы).
 * Держим в виде union-а, а не enum-а: сервис должен принимать
 * свежую категорию от нового модуля без правки самого себя.
 */
export type ActivityCategory =
  | "wallet"
  | "chat"
  | "governance"
  | "state"
  | "kernel"
  | "exchange"
  | string;

export type ActivityVisibility =
  | "public"
  | "node"
  | "audience"
  | "sovereign";

export interface ActivityLog {
  id: string;
  stateId: string;
  event: string;
  category: ActivityCategory;
  titleKey: string;
  titleParams: Record<string, unknown>;
  actorId: string | null;
  nodeId: string | null;
  visibility: ActivityVisibility;
  audienceUserIds: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Payload принятый `record()` — id / createdAt назначает БД. */
export interface RecordActivityInput {
  stateId: string;
  event: string;
  category: ActivityCategory;
  titleKey: string;
  titleParams?: Record<string, unknown>;
  actorId?: string | null;
  nodeId?: string | null;
  visibility?: ActivityVisibility;
  audienceUserIds?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Контекст зрителя. Мы не тянем полный `VerticalSnapshot`
 * (слишком тяжёлый для ленты, да и у гражданина его часто
 * нет под рукой) — нужно лишь плоское множество id «моих
 * узлов + их предков».
 */
export interface ActivityViewerContext {
  userId: string;
  stateId: string;
  /** Является ли зритель владельцем State. Owner видит всё. */
  isOwner: boolean;
  /**
   * Множество id-шников узлов, членом которых зритель является
   * (или которые являются предками его узлов). Используется
   * для фильтрации `visibility = 'node'`.
   */
  scopeNodeIds: ReadonlySet<string>;
}

export interface ListActivityOptions {
  limit?: number;
  before?: Date | null;
  category?: ActivityCategory | null;
  /**
   * Точное имя канонического события (`core.wallet.transaction.created`,
   * `core.broadcast.sovereign`, …). Удобно для Audit Log, где Суверен
   * хочет поднять историю конкретного типа действий.
   */
  event?: string | null;
  /** Фильтр по инициатору — тоже для Audit Log. */
  actorId?: string | null;
}

// ------------------------------------------------------------
// Repository contract
// ------------------------------------------------------------

export interface ActivityRepository {
  insert(input: RecordActivityInput): Promise<ActivityLog>;
  /**
   * Возвращает НЕфильтрованный хвост ленты в пределах одного
   * State — фильтрация по видимости выполняется в сервисе, чтобы
   * SQL оставался плоским и использовал индекс (stateId, createdAt).
   *
   * Сервис сам накручивает limit с запасом, если понимает, что
   * часть строк уйдёт в отвал из-за visibility.
   */
  listByState(
    stateId: string,
    opts: {
      limit: number;
      before: Date | null;
      category: ActivityCategory | null;
      event?: string | null;
      actorId?: string | null;
    },
  ): Promise<ActivityLog[]>;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface ActivityFeedServiceDeps {
  repo: ActivityRepository;
  /** Optional — when provided, `record()` fan-outs to realtime subscribers. */
  bus?: ModuleEventBus;
}

export const ACTIVITY_EVENTS = {
  /**
   * Каноническое имя события, которое сервис публикует ПОСЛЕ
   * успешной записи строки в БД. SSE-роут `/api/activity/stream`
   * слушает его и толкает новые строки открытым сессиям.
   */
  Recorded: "core.activity.recorded",
} as const;

export interface ActivityRecordedEvent {
  entry: ActivityLog;
}

export class ActivityFeedService {
  private readonly repo: ActivityRepository;
  private readonly bus: ModuleEventBus | null;

  constructor(deps: ActivityFeedServiceDeps) {
    this.repo = deps.repo;
    this.bus = deps.bus ?? null;
  }

  /**
   * Записывает одну строку и публикует `core.activity.recorded`.
   * Использует best-effort семантику: если БД недоступна — НЕ
   * бросает в хендлер шины (это не должно валить модули, ради
   * которых мы только что отработали основную бизнес-операцию).
   */
  async record(input: RecordActivityInput): Promise<ActivityLog | null> {
    try {
      const entry = await this.repo.insert({
        stateId: input.stateId,
        event: input.event,
        category: input.category,
        titleKey: input.titleKey,
        titleParams: input.titleParams ?? {},
        actorId: input.actorId ?? null,
        nodeId: input.nodeId ?? null,
        visibility: input.visibility ?? "public",
        audienceUserIds: input.audienceUserIds ?? [],
        metadata: input.metadata ?? {},
      });
      if (this.bus) {
        void this.bus
          .emit<ActivityRecordedEvent>(ACTIVITY_EVENTS.Recorded, { entry })
          .catch(() => {});
      }
      return entry;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ActivityFeed] failed to record:", err);
      return null;
    }
  }

  /**
   * Возвращает ленту, отфильтрованную по зрителю. Сервис берёт
   * хвост из БД с `overfetch`-ом и пробегается по нему правилом
   * видимости — так мы не разгоняем JOIN-ы ради проверки, которую
   * проще выразить в коде.
   */
  async listForViewer(
    viewer: ActivityViewerContext,
    opts: ListActivityOptions = {},
  ): Promise<ActivityLog[]> {
    const limit = clampLimit(opts.limit ?? 50);
    const before = opts.before ?? null;
    const category = opts.category ?? null;
    const event = opts.event ?? null;
    const actorId = opts.actorId ?? null;

    // Overfetch — ранее отфильтрованные строки уменьшают видимую
    // пачку. Хватит 3× лимита для практических нагрузок.
    const overfetch = Math.min(500, limit * 3);
    const rows = await this.repo.listByState(viewer.stateId, {
      limit: overfetch,
      before,
      category,
      event,
      actorId,
    });

    const visible = rows.filter((row) => isVisibleTo(row, viewer));
    return visible.slice(0, limit);
  }

  /** Проверка видимости одной строки — удобно для SSE-фильтра. */
  isVisibleTo(entry: ActivityLog, viewer: ActivityViewerContext): boolean {
    return isVisibleTo(entry, viewer);
  }
}

function clampLimit(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 50;
  return Math.min(200, Math.floor(raw));
}

/**
 * Центральная функция «имеет ли право гражданин видеть эту строку».
 *
 *   * actor-self: мы всегда показываем событие, инициатором которого
 *     был сам зритель. Иначе «Вы сделали перевод 50 KRN» куда-то
 *     потеряется, если видимость изначально `sovereign`/`node`.
 *   * audience:    лента точечно адресована зрителю.
 *   * public:      каждому гражданину state.
 *   * node:        зритель состоит в `nodeId` или в любом из его
 *                  предков.
 *   * sovereign:   только owner state (проверено выше).
 */
function isVisibleTo(
  entry: ActivityLog,
  viewer: ActivityViewerContext,
): boolean {
  if (entry.stateId !== viewer.stateId) return false;
  if (viewer.isOwner) return true;
  if (entry.actorId && entry.actorId === viewer.userId) return true;
  if (entry.audienceUserIds.includes(viewer.userId)) return true;
  switch (entry.visibility) {
    case "public":
      return true;
    case "audience":
      return entry.audienceUserIds.includes(viewer.userId);
    case "sovereign":
      return false;
    case "node":
      if (!entry.nodeId) return false;
      return viewer.scopeNodeIds.has(entry.nodeId);
    default:
      return false;
  }
}

// ------------------------------------------------------------
// Event Bus subscribers — перевод канонических событий модулей
// в строки `ActivityLog`.
// ------------------------------------------------------------
//
// Мы подписываемся на узкий white-list событий. Модули публикуют
// гораздо больше внутренних сигналов (например, `chat.message.created`
// на каждое сообщение) — в ленту идут только те, что действительно
// интересны гражданину.
//
// Payload-ы из модулей импортируются через type-only: core не должен
// тянуть реализацию модуля, мы просто описываем shape сверху.

/** Lightweight payload типы — mirror из `src/modules/*`. */
interface WalletTxEvent {
  stateId: string;
  transaction: {
    id: string;
    fromWalletId: string | null;
    toWalletId: string | null;
    kind: "transfer" | "treasury_allocation" | "mint" | "burn";
    status: string;
    amount: number;
    currency: string;
    initiatedById: string;
  };
  recipientUserIds: string[];
}

interface ChatChannelCreatedEvent {
  stateId: string;
  channelId: string;
  nodeId: string | null;
}

interface ChatMessageCreatedShape {
  stateId: string;
  channelId: string;
  nodeId: string | null;
  message: {
    id: string;
    authorId: string;
    body: string;
    isDirective: boolean;
    directiveFromNode: string | null;
  };
  recipientUserIds: string[];
}

interface ProposalCreatedShape {
  stateId: string;
  proposalId: string;
  createdById: string;
  targetConfigKey: string;
}

interface ProposalClosedShape {
  stateId: string;
  proposalId: string;
  status: string;
}

interface ProposalExecutedShape {
  stateId: string;
  proposalId: string;
  appliedBy: string;
  key: string;
  value: unknown;
}

interface ProposalVetoedShape {
  stateId: string;
  proposalId: string;
  vetoedById: string;
  reason: string | null;
}

interface StateSettingsUpdatedShape {
  stateId: string;
  updatedById: string;
  after: { transactionTaxRate?: number; [k: string]: unknown };
}

/**
 * Имена канонических событий на шине, которые мы хотим видеть в ленте.
 * Держим их локально строками, а не импортом из модулей — так core не
 * зависит от `@/modules/*` (контрактом служит shape, а не константа).
 */
const SUBSCRIBED_EVENTS = {
  // Wallet
  WalletTx: "core.wallet.transaction.created",
  // Chat
  ChatChannelCreated: "core.chat.channel.created",
  ChatMessageCreated: "core.chat.message.created",
  // Governance
  ProposalCreated: "core.governance.proposal.created",
  ProposalClosed: "core.governance.proposal.closed",
  ProposalExecuted: "core.governance.proposal.executed",
  ProposalVetoed: "core.governance.proposal.vetoed",
  // State config
  StateSettingsUpdated: "core.state.settings.updated",
} as const;

/**
 * Подписывает `service` на Event Bus и возвращает функцию-отписку.
 * Вызывается один раз при старте процесса; идемпотентность —
 * ответственность вызывающего (см. `src/server/activity-boot.ts`).
 */
export function subscribeActivityFeed(
  bus: ModuleEventBus,
  service: ActivityFeedService,
): () => void {
  const offs: Array<() => void> = [];

  // ---- Wallet transactions ----
  offs.push(
    bus.on<WalletTxEvent>(SUBSCRIBED_EVENTS.WalletTx, (evt) => {
      if (!evt || evt.transaction.status !== "completed") return;
      const tx = evt.transaction;

      // Key/params/visibility выбираем по типу транзакции.
      const { titleKey, visibility, category, nodeHint } =
        classifyWalletTx(tx);

      const audience = new Set<string>(evt.recipientUserIds ?? []);
      audience.add(tx.initiatedById);

      void service.record({
        stateId: evt.stateId,
        event: SUBSCRIBED_EVENTS.WalletTx,
        category,
        titleKey,
        titleParams: {
          amount: Decimal.isDecimal(tx.amount) ? tx.amount.toNumber() : tx.amount,
          currency: tx.currency,
          kind: tx.kind,
        },
        actorId: tx.initiatedById,
        nodeId: nodeHint ?? null,
        visibility,
        audienceUserIds: [...audience],
        metadata: {
          transactionId: tx.id,
          kind: tx.kind,
          fromWalletId: tx.fromWalletId,
          toWalletId: tx.toWalletId,
        },
      });
    }),
  );

  // ---- Chat channel created ----
  offs.push(
    bus.on<ChatChannelCreatedEvent>(
      SUBSCRIBED_EVENTS.ChatChannelCreated,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ChatChannelCreated,
          category: "chat",
          titleKey: "pulse.event.chat.channel_created",
          titleParams: {},
          nodeId: evt.nodeId ?? null,
          visibility: evt.nodeId ? "node" : "public",
          metadata: { channelId: evt.channelId },
        });
      },
    ),
  );

  // ---- Chat: only DIRECTIVES make it into the Pulse ----
  //
  // Обычные сообщения создают шум (сотни строк в час). Директивы
  // — это формальные приказы, их немного, и они действительно
  // должны попадать в ленту.
  offs.push(
    bus.on<ChatMessageCreatedShape>(
      SUBSCRIBED_EVENTS.ChatMessageCreated,
      (evt) => {
        if (!evt || !evt.message.isDirective) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ChatMessageCreated,
          category: "chat",
          titleKey: "pulse.event.chat.directive",
          titleParams: {
            body: truncate(evt.message.body, 140),
          },
          actorId: evt.message.authorId,
          nodeId: evt.nodeId ?? evt.message.directiveFromNode ?? null,
          visibility: "audience",
          audienceUserIds: Array.from(
            new Set([evt.message.authorId, ...(evt.recipientUserIds ?? [])]),
          ),
          metadata: {
            channelId: evt.channelId,
            messageId: evt.message.id,
            directiveFromNode: evt.message.directiveFromNode,
          },
        });
      },
    ),
  );

  // ---- Governance: proposals ----
  offs.push(
    bus.on<ProposalCreatedShape>(
      SUBSCRIBED_EVENTS.ProposalCreated,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ProposalCreated,
          category: "governance",
          titleKey: "pulse.event.governance.proposal_created",
          titleParams: { key: evt.targetConfigKey },
          actorId: evt.createdById,
          visibility: "public",
          metadata: {
            proposalId: evt.proposalId,
            targetConfigKey: evt.targetConfigKey,
          },
        });
      },
    ),
  );
  offs.push(
    bus.on<ProposalClosedShape>(
      SUBSCRIBED_EVENTS.ProposalClosed,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ProposalClosed,
          category: "governance",
          titleKey: `pulse.event.governance.proposal_${evt.status}`,
          titleParams: { status: evt.status },
          visibility: "public",
          metadata: { proposalId: evt.proposalId, status: evt.status },
        });
      },
    ),
  );
  offs.push(
    bus.on<ProposalExecutedShape>(
      SUBSCRIBED_EVENTS.ProposalExecuted,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ProposalExecuted,
          category: "governance",
          titleKey: "pulse.event.governance.proposal_executed",
          titleParams: { key: evt.key, value: stringifyValue(evt.value) },
          actorId: evt.appliedBy,
          visibility: "public",
          metadata: {
            proposalId: evt.proposalId,
            key: evt.key,
            value: evt.value as unknown,
          },
        });
      },
    ),
  );
  offs.push(
    bus.on<ProposalVetoedShape>(
      SUBSCRIBED_EVENTS.ProposalVetoed,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.ProposalVetoed,
          category: "governance",
          titleKey: "pulse.event.governance.proposal_vetoed",
          titleParams: { reason: evt.reason ?? "" },
          actorId: evt.vetoedById,
          visibility: "public",
          metadata: { proposalId: evt.proposalId, reason: evt.reason },
        });
      },
    ),
  );

  // ---- State settings ----
  offs.push(
    bus.on<StateSettingsUpdatedShape>(
      SUBSCRIBED_EVENTS.StateSettingsUpdated,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: SUBSCRIBED_EVENTS.StateSettingsUpdated,
          category: "state",
          titleKey: "pulse.event.state.settings_updated",
          titleParams: {},
          actorId: evt.updatedById,
          visibility: "public",
          metadata: {},
        });
      },
    ),
  );

  // ---- Kernel: state + vertical lifecycle ----
  offs.push(
    bus.on<{ stateId: string; actorId?: string | null }>(
      KernelEvents.StateCreated,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: KernelEvents.StateCreated,
          category: "kernel",
          titleKey: "pulse.event.kernel.state_created",
          actorId: evt.actorId ?? null,
          visibility: "public",
        });
      },
    ),
  );
  offs.push(
    bus.on<{ stateId: string; userId: string; nodeId: string; actorId?: string | null }>(
      KernelEvents.MembershipGranted,
      (evt) => {
        if (!evt) return;
        void service.record({
          stateId: evt.stateId,
          event: KernelEvents.MembershipGranted,
          category: "kernel",
          titleKey: "pulse.event.kernel.membership_granted",
          titleParams: {},
          actorId: evt.actorId ?? null,
          nodeId: evt.nodeId,
          audienceUserIds: [evt.userId],
          visibility: "node",
        });
      },
    ),
  );

  return () => {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* best-effort teardown */
      }
    }
  };
}

function classifyWalletTx(tx: WalletTxEvent["transaction"]): {
  titleKey: string;
  visibility: ActivityVisibility;
  category: ActivityCategory;
  nodeHint: string | null;
} {
  switch (tx.kind) {
    case "treasury_allocation":
      // Бюджет → сотруднику / другому узлу. Событие точечное — видно
      // инициатору + получателю + всем, кто уже есть в recipientUserIds
      // (этот список строит WalletService, он включает членов узла).
      return {
        titleKey: "pulse.event.wallet.treasury_allocation",
        visibility: "audience",
        category: "wallet",
        nodeHint: null,
      };
    case "mint":
      return {
        titleKey: "pulse.event.wallet.mint",
        visibility: "public",
        category: "wallet",
        nodeHint: null,
      };
    case "burn":
      return {
        titleKey: "pulse.event.wallet.burn",
        visibility: "public",
        category: "wallet",
        nodeHint: null,
      };
    case "transfer":
    default:
      return {
        titleKey: "pulse.event.wallet.transfer",
        visibility: "audience",
        category: "wallet",
        nodeHint: null,
      };
  }
}

function truncate(s: string, max: number): string {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return truncate(v, 80);
  try {
    return truncate(JSON.stringify(v), 80);
  } catch {
    return "";
  }
}

// Re-export для удобства интеграции.
export const ACTIVITY_SUBSCRIBED_EVENTS = SUBSCRIBED_EVENTS;
