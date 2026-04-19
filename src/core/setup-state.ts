/**
 * Setup State — первый запуск KrwnOS.
 * ------------------------------------------------------------
 * Идемпотентный bootstrap. Ровно один раз за жизнь инстанса:
 *   1. Спрашивает у владельца название государства + handle.
 *   2. Создаёт запись `User` (Суверен).
 *   3. Создаёт `State`, привязанный к этому User.
 *   4. Создаёт корневой `VerticalNode` типа `rank` с титулом
 *      "Sovereign" и permissions=["*"] — высший уровень вертикали.
 *   5. Кладёт владельца в `Membership` корневого узла.
 *   6. Выпускает первичный CLI-токен с scope `["*"]`,
 *      чтобы `krwn login` заработал мгновенно.
 *
 * Экспортирует чистую функцию `setupState()` — её удобно
 * дергать из unit-тестов или setup-wizard UI.
 * Внизу файла — интерактивный runner (readline), запускаемый
 * через `npm run setup` или `tsx src/core/setup-state.ts`.
 */

import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_THEME_CONFIG } from "./theme";

// ============================================================
// 1. Pure API
// ============================================================

export interface SetupStateCurrency {
  /** Короткий тикер, unique per State. Default "KRN". */
  symbol?: string;
  /** Парадное название валюты. Default "Krona". */
  name?: string;
  /** Символ/эмодзи. Default "⚜". */
  icon?: string;
  /** HEX-цвет для UI. Default "#C9A227" (крона-золото). */
  color?: string;
  /** Минорные единицы. Default 18. */
  decimals?: number;
}

export interface SetupStateInviteSpec {
  /** Подпись к инвайту. Default "First minister". */
  label?: string;
  /** Сколько дней живёт инвайт. Default 30. `0` = бессрочно. */
  ttlDays?: number;
  /** Сколько раз можно воспользоваться. Default 1. */
  maxUses?: number;
  /** Origin для построения share-URL (иначе APP_URL env). */
  origin?: string;
}

export interface SetupStateInput {
  /** Название государства. */
  stateName: string;
  /** URL-slug. Если не задан — генерируется из stateName. */
  stateSlug?: string;
  /** Краткое описание (опционально). */
  stateDescription?: string;

  /** Уникальный @handle Суверена. */
  ownerHandle: string;
  /** Email (опционально; passkey/wallet тоже сработают). */
  ownerEmail?: string;
  /** Отображаемое имя. */
  ownerDisplayName?: string;

  /** Настройка первичной валюты. Без этого — создаётся дефолтный KRN. */
  currency?: SetupStateCurrency;

  /**
   * Если задано — на выходе bootstrap'а выпускается первый инвайт,
   * ведущий сразу в Sovereign node (для «министров» Суверена).
   * `null` / omitted = инвайт не создавать.
   */
  firstInvite?: SetupStateInviteSpec | null;
}

export interface SetupStateInviteResult {
  invitationId: string;
  token: string;
  url: string;
  code: string;
  expiresAt: Date | null;
  maxUses: number;
  label: string | null;
}

export interface SetupStateResult {
  userId: string;
  stateId: string;
  stateSlug: string;
  sovereignNodeId: string;
  /** ID узла «Прихожая» (waiting room) — куда попадают открытые регистрации. */
  lobbyNodeId: string;
  /** Personal wallet of the Sovereign. */
  walletId: string;
  /** ID первичного StateAsset. */
  primaryAssetId: string;
  /** Тикер первичной валюты. */
  primaryAssetSymbol: string;
  /** Plaintext CLI token — показывается ОДИН раз. */
  cliToken: string;
  cliTokenId: string;
  /** Одноразовый инвайт «первого министра», если запрошен. */
  invite: SetupStateInviteResult | null;
}

export class AlreadyInitialisedError extends Error {
  constructor() {
    super("KrwnOS is already initialised (a State already exists).");
    this.name = "AlreadyInitialisedError";
  }
}

/**
 * Выполняет первичный bootstrap в одной транзакции.
 * Бросает `AlreadyInitialisedError`, если State уже существует.
 */
export async function setupState(
  input: SetupStateInput,
): Promise<SetupStateResult> {
  validateInput(input);

  const existing = await prisma.state.count();
  if (existing > 0) throw new AlreadyInitialisedError();

  const slug = normaliseSlug(input.stateSlug ?? input.stateName);
  const handle = normaliseHandle(input.ownerHandle);
  const currency = normaliseCurrency(input.currency);

  // Plaintext токен генерится снаружи транзакции — всё равно нужен
  // снаружи для печати пользователю.
  const rawCliToken = `kt_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(rawCliToken).digest("hex");

  // То же самое с первичным инвайтом: plaintext-токен уходит
  // наружу ровно один раз, в БД ложится sha256(token).
  const inviteSpec = input.firstInvite ?? null;
  const inviteRaw = inviteSpec
    ? generateInviteToken()
    : null;
  const inviteHash = inviteRaw
    ? createHash("sha256").update(inviteRaw).digest("hex")
    : null;
  const inviteCode = inviteSpec ? generateInviteCode() : null;
  const inviteExpires =
    inviteSpec && inviteSpec.ttlDays && inviteSpec.ttlDays > 0
      ? new Date(Date.now() + inviteSpec.ttlDays * 24 * 60 * 60 * 1000)
      : inviteSpec
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : null;
  const inviteMaxUses = inviteSpec?.maxUses ?? 1;
  const inviteLabel = inviteSpec?.label ?? "First minister";

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        handle,
        email: input.ownerEmail ?? null,
        displayName: input.ownerDisplayName ?? input.ownerHandle,
      },
    });

    const state = await (tx as unknown as {
      state: {
        create: (args: {
          data: {
            slug: string;
            name: string;
            description: string | null;
            ownerId: string;
            config: unknown;
            themeConfig: unknown;
          };
        }) => Promise<{ id: string; slug: string }>;
      };
    }).state.create({
      data: {
        slug,
        name: input.stateName,
        description: input.stateDescription ?? null,
        ownerId: user.id,
        config: {
          installedModules: [],
          flags: { firstRunCompleted: true },
        },
        // Theme Engine default — Minimalist High-Tech. Живёт в
        // отдельной колонке (не внутри `config`), чтобы SSR в
        // `src/app/layout.tsx` мог прочитать её одним `select`.
        themeConfig: DEFAULT_THEME_CONFIG,
      },
    });

    const sovereignNode = await tx.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: null,
        title: "Sovereign",
        type: "rank",
        // Высший уровень вертикали — неявный super-power.
        permissions: ["*"],
        order: 0,
      },
    });

    // "Прихожая" — узел, куда приземляются открытые регистрации
    // (тип А). Права НЕ даёт; пользователь остаётся в статусе
    // `pending` до тех пор, пока кто-то из вертикали не переведёт
    // его в реальный узел.
    const lobbyNode = await tx.verticalNode.create({
      data: {
        stateId: state.id,
        parentId: sovereignNode.id,
        title: "Waiting Room",
        type: "rank",
        permissions: [],
        order: 999,
        isLobby: true,
      },
    });

    await tx.membership.create({
      data: {
        userId: user.id,
        nodeId: sovereignNode.id,
        title: "Sovereign",
        status: "active",
      },
    });

    // National currency seed — every fresh State starts with a
    // Local Ledger asset flagged as the primary. The Sovereign
    // picks the ticker, display name and glyph in the First-Launch
    // Wizard; additional assets (EXTERNAL tokens, HYBRID peggings)
    // can be added later via the Currency Factory.
    const primaryAsset = await (tx as unknown as {
      stateAsset: {
        create: (args: unknown) => Promise<{ id: string; symbol: string }>;
      };
    }).stateAsset.create({
      data: {
        stateId: state.id,
        symbol: currency.symbol,
        name: currency.name,
        type: "INTERNAL",
        mode: "LOCAL",
        decimals: currency.decimals,
        isPrimary: true,
        icon: currency.icon,
        color: currency.color,
        metadata: { seed: true },
      },
    });

    // Personal wallet for the Sovereign (one per User × State ×
    // StateAsset). Bound to the national currency by default.
    const wallet = await tx.wallet.create({
      data: {
        stateId: state.id,
        type: "PERSONAL",
        userId: user.id,
        address: generateLedgerAddress("usr"),
        currency: primaryAsset.symbol,
        assetId: primaryAsset.id,
      },
    });

    // Палата Указов — создаём пустую конституцию с дефолтными
    // значениями сразу при bootstrap-е. Без неё первый запрос к
    // `/api/state/constitution` лениво создал бы строку, но лучше,
    // чтобы таблица всегда была синхронна с набором State.
    await (tx as unknown as {
      stateSettings: {
        create: (args: unknown) => Promise<unknown>;
      };
    }).stateSettings.create({
      data: {
        stateId: state.id,
      },
    });

    const cliToken = await tx.cliToken.create({
      data: {
        userId: user.id,
        stateId: state.id,
        tokenHash,
        label: "bootstrap",
        scopes: ["*"],
      },
    });

    // Первый «магический» инвайт. Ведёт прямиком в Sovereign node,
    // чтобы приглашённый сразу стал «министром» с унаследованными
    // правами — это то, чего требует первая Коронация.
    let invitationRow: {
      id: string;
      code: string;
      expiresAt: Date | null;
      maxUses: number;
      label: string | null;
    } | null = null;

    if (inviteSpec && inviteHash && inviteCode) {
      invitationRow = await tx.invitation.create({
        data: {
          stateId: state.id,
          targetNodeId: sovereignNode.id,
          createdById: user.id,
          tokenHash: inviteHash,
          code: inviteCode,
          label: inviteLabel,
          maxUses: inviteMaxUses,
          expiresAt: inviteExpires,
        },
        select: {
          id: true,
          code: true,
          expiresAt: true,
          maxUses: true,
          label: true,
        },
      });
    }

    return {
      userId: user.id,
      stateId: state.id,
      stateSlug: state.slug,
      sovereignNodeId: sovereignNode.id,
      lobbyNodeId: lobbyNode.id,
      walletId: wallet.id,
      primaryAssetId: primaryAsset.id,
      primaryAssetSymbol: primaryAsset.symbol,
      cliToken: rawCliToken,
      cliTokenId: cliToken.id,
      invitationRow,
    };
  });

  // Strip the internal invitation row and re-wrap with the plaintext
  // token / share URL. The raw token NEVER goes into the transaction
  // — it's only known in memory here and handed back to the caller.
  const origin =
    inviteSpec?.origin ??
    process.env.APP_URL ??
    "http://localhost:3000";

  const invite: SetupStateInviteResult | null =
    result.invitationRow && inviteRaw
      ? {
          invitationId: result.invitationRow.id,
          token: inviteRaw,
          url: `${origin.replace(/\/$/, "")}/invite/${inviteRaw}`,
          code: result.invitationRow.code,
          expiresAt: result.invitationRow.expiresAt,
          maxUses: result.invitationRow.maxUses,
          label: result.invitationRow.label,
        }
      : null;

  return {
    userId: result.userId,
    stateId: result.stateId,
    stateSlug: result.stateSlug,
    sovereignNodeId: result.sovereignNodeId,
    lobbyNodeId: result.lobbyNodeId,
    walletId: result.walletId,
    primaryAssetId: result.primaryAssetId,
    primaryAssetSymbol: result.primaryAssetSymbol,
    cliToken: result.cliToken,
    cliTokenId: result.cliTokenId,
    invite,
  };
}

// ============================================================
// 2. Validation & slug helpers
// ============================================================

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANDLE_RE = /^[a-z0-9_]{3,32}$/;
const SLUG_RESERVED = new Set([
  "api",
  "admin",
  "setup",
  "invite",
  "login",
  "logout",
  "app",
  "dashboard",
  "s",
  "static",
  "_next",
]);

function validateInput(input: SetupStateInput): void {
  if (!input.stateName || input.stateName.trim().length < 2) {
    throw new Error("State name must be at least 2 characters.");
  }
  if (input.stateName.length > 80) {
    throw new Error("State name must be at most 80 characters.");
  }
  const handle = normaliseHandle(input.ownerHandle);
  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      "Owner handle must be 3–32 chars, [a-z0-9_] only.",
    );
  }
  const slug = normaliseSlug(input.stateSlug ?? input.stateName);
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Derived slug "${slug}" is invalid. Provide --slug explicitly.`,
    );
  }
  if (SLUG_RESERVED.has(slug)) {
    throw new Error(`Slug "${slug}" is reserved. Choose another.`);
  }
  if (input.ownerEmail && !/^\S+@\S+\.\S+$/.test(input.ownerEmail)) {
    throw new Error("Invalid email format.");
  }
  if (input.currency) validateCurrency(input.currency);
}

const CURRENCY_SYMBOL_RE = /^[A-Z0-9]{2,12}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function validateCurrency(c: SetupStateCurrency): void {
  if (c.symbol !== undefined) {
    const sym = c.symbol.trim().toUpperCase();
    if (!CURRENCY_SYMBOL_RE.test(sym)) {
      throw new Error(
        "Currency symbol must be 2–12 uppercase letters/digits (e.g. KRN, GOLD, USD1).",
      );
    }
  }
  if (c.name !== undefined && (c.name.trim().length < 2 || c.name.length > 60)) {
    throw new Error("Currency name must be 2–60 characters.");
  }
  if (c.icon !== undefined && c.icon.length > 8) {
    throw new Error("Currency icon must be at most 8 characters.");
  }
  if (c.color !== undefined && !HEX_COLOR_RE.test(c.color)) {
    throw new Error("Currency color must be a HEX string like #C9A227.");
  }
  if (c.decimals !== undefined) {
    if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 36) {
      throw new Error("Currency decimals must be an integer in [0..36].");
    }
  }
}

interface ResolvedCurrency {
  symbol: string;
  name: string;
  icon: string;
  color: string;
  decimals: number;
}

function normaliseCurrency(c?: SetupStateCurrency): ResolvedCurrency {
  return {
    symbol: (c?.symbol ?? "KRN").trim().toUpperCase(),
    name: (c?.name ?? "Krona").trim(),
    icon: c?.icon?.trim() || "⚜",
    color: c?.color?.trim() || "#C9A227",
    decimals: c?.decimals ?? 18,
  };
}

function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * «KRWN-XXXX-XXXX» — человекочитаемый код для QR и устного обмена.
 * Crockford alphabet (без 0/O/1/I/L — неоднозначных символов).
 */
function generateInviteCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const pick = () => {
    const b = randomBytes(4);
    let s = "";
    for (const byte of b) s += alphabet[byte % alphabet.length];
    return s;
  };
  return `KRWN-${pick()}-${pick()}`;
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normaliseHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Internal ledger address for new wallets. Not an EVM / Solana key.
 * Kept here (and mirrored in `modules/wallet/repo.ts`) so the core
 * bootstrap doesn't need to import a plugin.
 */
function generateLedgerAddress(prefix: "usr" | "tre"): string {
  const body = randomBytes(16).toString("hex");
  return `krwn1${prefix}${body}`;
}

// ============================================================
// 3. CLI runner (interactive + non-interactive)
// ============================================================
//
// Запуск:
//     tsx src/core/setup-state.ts                           # интерактивно
//     tsx src/core/setup-state.ts --state "X" --handle red  # без вопросов
//     tsx src/core/setup-state.ts --json                    # для CI
//
// Поддерживаемые флаги:
//     --state <name>         Название государства
//     --slug <slug>          URL-slug (default: auto)
//     --description <text>   Описание
//     --handle <handle>      @handle Суверена
//     --email <email>        Email (опционально)
//     --display <name>       Отображаемое имя (default: handle)
//     --json                 Вывод результата в JSON (для автоматизации)
//     --yes                  Не задавать уточняющих вопросов
// ============================================================

const pretty = {
  title: (m: string) => `\x1b[1m${m}\x1b[0m`,
  crown: (m: string) => `\x1b[33m${m}\x1b[0m`,
  dim: (m: string) => `\x1b[90m${m}\x1b[0m`,
  ok: (m: string) => `\x1b[32m${m}\x1b[0m`,
  err: (m: string) => `\x1b[31m${m}\x1b[0m`,
};

async function runCli(): Promise<void> {
  const { parseArgs } = await import("node:util");
  const { stdout: output, stderr: errout, argv } = await import("node:process");

  let flags: Record<string, string | boolean | undefined>;
  try {
    const parsed = parseArgs({
      args: argv.slice(2),
      options: {
        state: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        handle: { type: "string" },
        email: { type: "string" },
        display: { type: "string" },
        "currency-symbol": { type: "string" },
        "currency-name": { type: "string" },
        "currency-icon": { type: "string" },
        "currency-color": { type: "string" },
        "currency-decimals": { type: "string" },
        "skip-invite": { type: "boolean", default: false },
        "invite-ttl-days": { type: "string" },
        json: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", default: false, short: "h" },
      },
      strict: true,
    });
    flags = parsed.values as Record<string, string | boolean | undefined>;
  } catch (err) {
    errout.write(
      pretty.err(
        `  ✗ ${err instanceof Error ? err.message : String(err)}\n`,
      ) + "\n",
    );
    process.exitCode = 64; // EX_USAGE
    return;
  }

  if (flags.help) {
    output.write(renderHelp());
    return;
  }

  const json = Boolean(flags.json);

  try {
    const existing = await prisma.state.count();
    if (existing > 0) {
      emitError(
        json,
        "already_initialised",
        "KrwnOS is already initialised (a State already exists).",
      );
      process.exitCode = 2;
      return;
    }

    const input = (flags.yes || isNonInteractive(flags))
      ? nonInteractiveInput(flags)
      : await promptInteractive(flags);

    const result = await setupState(input);

    if (json) {
      output.write(JSON.stringify({ ok: true, ...result }, null, 2) + "\n");
    } else {
      emitSuccess(result);
    }
  } catch (err) {
    if (err instanceof AlreadyInitialisedError) {
      emitError(json, "already_initialised", err.message);
      process.exitCode = 2;
    } else {
      emitError(
        json,
        "setup_failed",
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function isNonInteractive(
  flags: Record<string, string | boolean | undefined>,
): boolean {
  return Boolean(flags.state && flags.handle);
}

function nonInteractiveInput(
  flags: Record<string, string | boolean | undefined>,
): SetupStateInput {
  if (!flags.state || typeof flags.state !== "string") {
    throw new Error("`--state` is required in non-interactive mode.");
  }
  if (!flags.handle || typeof flags.handle !== "string") {
    throw new Error("`--handle` is required in non-interactive mode.");
  }
  return {
    stateName: flags.state,
    stateSlug: stringOrUndef(flags.slug),
    stateDescription: stringOrUndef(flags.description),
    ownerHandle: flags.handle,
    ownerDisplayName: stringOrUndef(flags.display),
    ownerEmail: stringOrUndef(flags.email),
    currency: currencyFromFlags(flags),
    firstInvite: flags["skip-invite"]
      ? null
      : {
          ttlDays: intOrUndef(flags["invite-ttl-days"]) ?? 30,
          maxUses: 1,
          label: "First minister",
        },
  };
}

function currencyFromFlags(
  flags: Record<string, string | boolean | undefined>,
): SetupStateCurrency | undefined {
  const sym = stringOrUndef(flags["currency-symbol"]);
  const name = stringOrUndef(flags["currency-name"]);
  const icon = stringOrUndef(flags["currency-icon"]);
  const color = stringOrUndef(flags["currency-color"]);
  const decimals = intOrUndef(flags["currency-decimals"]);
  if (!sym && !name && !icon && !color && decimals === undefined) return undefined;
  return {
    symbol: sym,
    name,
    icon,
    color,
    decimals,
  };
}

function intOrUndef(v: unknown): number | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

async function promptInteractive(
  flags: Record<string, string | boolean | undefined>,
): Promise<SetupStateInput> {
  const { createInterface } = await import("node:readline/promises");
  const { stdin: input, stdout: output } = await import("node:process");
  const rl = createInterface({ input, output });

  try {
    output.write(
      [
        "",
        pretty.crown("  ╔════════════════════════════════════╗"),
        pretty.crown("  ║          KrwnOS — Setup            ║"),
        pretty.crown("  ╚════════════════════════════════════╝"),
        "",
        "  " +
          pretty.dim(
            "Первый запуск. Коронуем Суверена и создаём государство.",
          ),
        "",
      ].join("\n"),
    );

    const ask = async (label: string, preset?: string) => {
      if (preset !== undefined) {
        output.write(`  ${label}${pretty.dim(preset)}\n`);
        return preset;
      }
      return (await rl.question(`  ${label}`)).trim();
    };

    const stateName = await ask(
      "Название государства:  ",
      stringOrUndef(flags.state),
    );
    const stateSlug = await ask(
      `URL-slug ${pretty.dim("(Enter = авто)")}:      `,
      stringOrUndef(flags.slug),
    );
    const ownerHandle = await ask(
      "Ваш @handle:              ",
      stringOrUndef(flags.handle),
    );
    const ownerDisplayName = await ask(
      `Отображаемое имя ${pretty.dim("(Enter = handle)")}: `,
      stringOrUndef(flags.display),
    );
    const ownerEmail = await ask(
      `Email ${pretty.dim("(опционально)")}:         `,
      stringOrUndef(flags.email),
    );

    const currencySymbol = await ask(
      `Тикер валюты ${pretty.dim("(Enter = KRN)")}:    `,
      stringOrUndef(flags["currency-symbol"]),
    );
    const currencyName = await ask(
      `Название валюты ${pretty.dim("(Enter = Krona)")}:`,
      stringOrUndef(flags["currency-name"]),
    );
    const currencyIcon = await ask(
      `Глиф валюты ${pretty.dim("(Enter = ⚜)")}:       `,
      stringOrUndef(flags["currency-icon"]),
    );

    const hasCurrency =
      currencySymbol || currencyName || currencyIcon ||
      flags["currency-color"] || flags["currency-decimals"];

    return {
      stateName,
      stateSlug: stateSlug || undefined,
      stateDescription: stringOrUndef(flags.description),
      ownerHandle,
      ownerDisplayName: ownerDisplayName || undefined,
      ownerEmail: ownerEmail || undefined,
      currency: hasCurrency
        ? {
            symbol: currencySymbol || undefined,
            name: currencyName || undefined,
            icon: currencyIcon || undefined,
            color: stringOrUndef(flags["currency-color"]),
            decimals: intOrUndef(flags["currency-decimals"]),
          }
        : undefined,
      firstInvite: flags["skip-invite"]
        ? null
        : {
            ttlDays: intOrUndef(flags["invite-ttl-days"]) ?? 30,
            maxUses: 1,
            label: "First minister",
          },
    };
  } finally {
    rl.close();
  }
}

function emitSuccess(result: SetupStateResult): void {
  const { stdout: output } = process;
  const lines = [
    "",
    pretty.ok("  ✓ State создан."),
    `  ${pretty.dim("stateId:   ")}${result.stateId}`,
    `  ${pretty.dim("slug:      ")}${result.stateSlug}`,
    `  ${pretty.dim("sovereign: ")}${result.sovereignNodeId}`,
    `  ${pretty.dim("currency:  ")}${result.primaryAssetSymbol} (${result.primaryAssetId})`,
    "",
    pretty.title("  Ваш первичный CLI-токен (bootstrap):"),
    "",
    "    " + pretty.crown(result.cliToken),
    "",
    "  " + pretty.dim("Сохраните его — повторно показан не будет."),
    "  " + pretty.dim("Использовать:"),
    "    krwn login \\",
    `      --host ${process.env.APP_URL ?? "http://localhost:3000"} \\`,
    "      --token " + result.cliToken,
    "",
    "  " +
      pretty.dim(
        "Рекомендуется ротация после первого использования: `krwn token rotate`.",
      ),
  ];

  if (result.invite) {
    lines.push(
      "",
      pretty.title("  Первый magic-link инвайт (для министра):"),
      "",
      "    " + pretty.crown(result.invite.url),
      `    ${pretty.dim("code:     ")}${result.invite.code}`,
      `    ${pretty.dim("expires:  ")}${
        result.invite.expiresAt
          ? result.invite.expiresAt.toISOString()
          : "never"
      }`,
      `    ${pretty.dim("maxUses:  ")}${result.invite.maxUses}`,
      "",
      "  " +
        pretty.dim(
          "Ссылка показывается один раз. Передайте её приглашённому.",
        ),
    );
  }

  lines.push("");
  output.write(lines.join("\n"));
}

function emitError(json: boolean, code: string, message: string): void {
  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: false, code, message }) + "\n",
    );
  } else {
    process.stderr.write(pretty.err(`  ✗ ${message}\n`));
  }
}

function renderHelp(): string {
  return `
${pretty.title("krwn setup — инициализация KrwnOS")}

USAGE
  tsx src/core/setup-state.ts [options]
  npm run setup -- [options]

OPTIONS
  --state <name>                Название государства (required in --yes mode)
  --slug <slug>                 URL-slug (default: derived from --state)
  --description <text>          Краткое описание
  --handle <handle>             @handle Суверена (required in --yes mode)
  --email <email>               Email
  --display <name>              Отображаемое имя (default: handle)
  --currency-symbol <sym>       Тикер первичной валюты (default: KRN)
  --currency-name <name>        Название валюты (default: Krona)
  --currency-icon <glyph>       Глиф валюты (default: ⚜)
  --currency-color <hex>        Цвет UI (default: #C9A227)
  --currency-decimals <n>       Знаков после запятой (default: 18)
  --invite-ttl-days <n>         Срок жизни первого инвайта, дней (default: 30)
  --skip-invite                 Не создавать первый magic-link
  --json                        Результат в JSON (для CI)
  --yes                         Не задавать уточняющих вопросов
  -h, --help                    Показать эту справку

EXIT CODES
  0    ok
  1    generic failure
  2    already initialised
  64   invalid usage (EX_USAGE)
`;
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Detect direct invocation (works for both tsx and compiled node runs).
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const thisUrl = import.meta.url;
    // Compare by basename to stay portable across ESM loaders.
    return thisUrl.endsWith("/setup-state.ts") || thisUrl.endsWith("/setup-state.js") ||
      entry.endsWith("setup-state.ts") || entry.endsWith("setup-state.js");
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void runCli();
}
