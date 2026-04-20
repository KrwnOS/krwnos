import { describe, expect, it } from "vitest";
import { parseStartWithParam } from "../telegram-update";

describe("parseStartWithParam", () => {
  it("parses /start link_… with user and chat", () => {
    const r = parseStartWithParam({
      update_id: 1,
      message: {
        message_id: 2,
        from: { id: 4242, username: "neo" },
        chat: { id: 4242, type: "private" },
        text: "/start link_abc_xyz",
      },
    });
    expect(r).not.toBeNull();
    expect(r!.startParam).toBe("link_abc_xyz");
    expect(r!.telegramUser.id).toBe(4242);
    expect(r!.telegramUser.username).toBe("neo");
    expect(r!.chatId).toBe(4242);
  });

  it("returns null for bare /start", () => {
    expect(
      parseStartWithParam({
        message: {
          from: { id: 1 },
          chat: { id: 1 },
          text: "/start",
        },
      }),
    ).toBeNull();
  });
});
