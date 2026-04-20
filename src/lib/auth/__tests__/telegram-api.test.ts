import { describe, expect, it, vi } from "vitest";
import { telegramSendMessage } from "../telegram-api";

describe("telegramSendMessage", () => {
  it("POSTs to Telegram API with mocked fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await telegramSendMessage({
      botToken: "TEST",
      chatId: 1,
      text: "hi",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/botTEST/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      chat_id: 1,
      text: "hi",
    });
  });
});
