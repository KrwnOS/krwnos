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

// ============================================================
// 1. Pure API
// ============================================================

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
}

export interface SetupStateResult {
  userId: string;
  stateId: string;
  stateSlug: string;
  sovereignNodeId: string;
  /** Plaintext CLI token — показывается ОДИН раз. */
  cliToken: string;
  cliTokenId: string;
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

  // Plaintext токен генерится снаружи транзакции — всё равно нужен
  // снаружи для печати пользователю.
  const rawCliToken = `kt_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(rawCliToken).digest("hex");

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        handle,
        email: input.ownerEmail ?? null,
        displayName: input.ownerDisplayName ?? input.ownerHandle,
      },
    });

    const state = await tx.state.create({
      data: {
        slug,
        name: input.stateName,
        description: input.stateDescription ?? null,
        ownerId: user.id,
        config: {
          theme: {},
          installedModules: [],
          flags: { firstRunCompleted: true },
        },
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

    await tx.membership.create({
      data: {
        userId: user.id,
        nodeId: sovereignNode.id,
        title: "Sovereign",
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

    return {
      userId: user.id,
      stateId: state.id,
      stateSlug: state.slug,
      sovereignNodeId: sovereignNode.id,
      cliToken: rawCliToken,
      cliTokenId: cliToken.id,
    };
  });

  return result;
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
  };
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

    return {
      stateName,
      stateSlug: stateSlug || undefined,
      stateDescription: stringOrUndef(flags.description),
      ownerHandle,
      ownerDisplayName: ownerDisplayName || undefined,
      ownerEmail: ownerEmail || undefined,
    };
  } finally {
    rl.close();
  }
}

function emitSuccess(result: SetupStateResult): void {
  const { stdout: output } = process;
  output.write(
    [
      "",
      pretty.ok("  ✓ State создан."),
      `  ${pretty.dim("stateId:  ")}${result.stateId}`,
      `  ${pretty.dim("slug:     ")}${result.stateSlug}`,
      `  ${pretty.dim("sovereign:")}${result.sovereignNodeId}`,
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
      "",
    ].join("\n"),
  );
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
  --state <name>         Название государства (required in --yes mode)
  --slug <slug>          URL-slug (default: derived from --state)
  --description <text>   Краткое описание
  --handle <handle>      @handle Суверена (required in --yes mode)
  --email <email>        Email
  --display <name>       Отображаемое имя (default: handle)
  --json                 Результат в JSON (для CI)
  --yes                  Не задавать уточняющих вопросов
  -h, --help             Показать эту справку

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
