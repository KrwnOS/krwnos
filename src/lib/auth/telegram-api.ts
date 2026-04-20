/**
 * Минимальный клиент Telegram Bot API (sendMessage) — URL и токен только из env.
 */

export async function telegramSendMessage(opts: {
  botToken: string;
  chatId: number;
  text: string;
  /** Подмена в тестах / отладке. */
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const res = await fetchFn(
    `https://api.telegram.org/bot${opts.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text,
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${t}`);
  }
}
