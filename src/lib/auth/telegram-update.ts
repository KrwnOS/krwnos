/**
 * Разбор `Update` от Telegram Bot API (webhook / getUpdates).
 */

export interface TelegramUserLite {
  id: number;
  username?: string;
}

export interface ParsedTelegramStart {
  chatId: number;
  telegramUser: TelegramUserLite;
  /** Аргумент после `/start` (например `link_…`). */
  startParam: string;
}

function readMessage(update: Record<string, unknown>): Record<string, unknown> | null {
  const m = update.message;
  if (m && typeof m === "object") return m as Record<string, unknown>;
  return null;
}

/**
 * Возвращает данные только для сообщений `/start …` с непустым аргументом.
 */
export function parseStartWithParam(update: unknown): ParsedTelegramStart | null {
  if (!update || typeof update !== "object") return null;
  const msg = readMessage(update as Record<string, unknown>);
  if (!msg) return null;

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text.toLowerCase().startsWith("/start")) return null;

  const rest = text.slice("/start".length).trim();
  if (!rest) return null;

  const startParam = rest.split(/\s+/)[0] ?? "";
  if (!startParam) return null;

  const from = msg.from;
  if (!from || typeof from !== "object") return null;
  const uid = (from as { id?: unknown }).id;
  if (typeof uid !== "number" || !Number.isFinite(uid)) return null;

  const chat = msg.chat;
  const chatId =
    chat && typeof chat === "object" && typeof (chat as { id?: unknown }).id === "number"
      ? (chat as { id: number }).id
      : uid;

  const username =
    typeof (from as { username?: unknown }).username === "string"
      ? (from as { username: string }).username
      : undefined;

  return {
    chatId,
    telegramUser: { id: uid, username },
    startParam,
  };
}
