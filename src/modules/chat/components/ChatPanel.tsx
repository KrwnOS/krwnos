/**
 * ChatPanel — композитный виджет, который можно воткнуть в любую
 * страницу одной строкой: `<ChatPanel />`.
 *
 * Берёт на себя:
 *   * Экран подключения (ввод CLI-токена), если токен не сохранён.
 *   * Сборку Sidebar + Window + Pending-Directives tray.
 *   * Пропагацию текущего пользователя в `MessageRow` для подсветки
 *     «моих» сообщений.
 *
 * Компонент — клиентский. Если понадобится SSR-часть, её можно
 * обернуть `dynamic(() => import(...), { ssr: false })`.
 */

"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ChatSidebar } from "./ChatSidebar";
import { ChatWindow } from "./ChatWindow";
import { DirectiveBadge } from "./DirectiveBadge";
import { MarkdownText } from "./markdown";
import { useChat } from "./useChat";

export function ChatPanel({ className }: { className?: string }) {
  const chat = useChat();
  const { t } = useI18n();

  if (!chat.token) {
    return (
      <div className={cn("flex h-full items-center justify-center p-10", className)}>
        <ConnectForm onSubmit={chat.setToken} />
      </div>
    );
  }

  const activeInfo =
    chat.channels.find((c) => c.channel.id === chat.activeChannelId) ?? null;
  const activeMessages = chat.activeChannelId
    ? chat.messagesByChannel[chat.activeChannelId] ?? []
    : [];

  const currentUserId = chat.me?.userId ?? null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full overflow-hidden rounded-lg border border-border/60 bg-background",
        className,
      )}
    >
      <ChatSidebar
        channels={chat.channels}
        activeChannelId={chat.activeChannelId}
        onSelect={chat.setActiveChannel}
        pendingDirectives={chat.pendingDirectives}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {chat.pendingDirectives.length > 0 && (
          <PendingTray
            count={chat.pendingDirectives.length}
            onJump={chat.setActiveChannel}
            items={chat.pendingDirectives}
          />
        )}
        {chat.error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            {t("chat.apiErr", {
              status: chat.error.status,
              message: chat.error.message,
            })}
          </div>
        )}
        <ChatWindow
          channel={activeInfo}
          messages={activeMessages}
          currentUserId={currentUserId}
          pendingDirectives={chat.pendingDirectives}
          onSend={chat.sendMessage}
          onAcknowledge={chat.acknowledge}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------

function ConnectForm({
  onSubmit,
}: {
  onSubmit: (token: string | null) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onSubmit(trimmed);
      }}
      className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border/60 bg-muted/40 p-5"
    >
      <h3 className="text-sm font-semibold">{t("chat.connect.title")}</h3>
      <p className="text-xs text-foreground/60">
        {splitDesc(
          t("chat.connect.desc", {
            read: "%%READ%%",
            write: "%%WRITE%%",
            admin: "%%ADMIN%%",
            cmd: "%%CMD%%",
          }),
        )}
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="krwn_live_…"
        className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-crown"
        autoFocus
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="rounded-md bg-crown px-3 py-2 text-sm font-semibold text-black hover:bg-crown/90 disabled:opacity-50"
      >
        {t("chat.connect.submit")}
      </button>
    </form>
  );
}

/**
 * Tiny helper: the connect-form description interleaves four
 * inline `<code>` tokens. We render them by splitting on the
 * `%%TOKEN%%` markers the translator returned.
 */
function splitDesc(template: string): React.ReactNode {
  const tokens: Record<string, string> = {
    "%%READ%%": "chat.read",
    "%%WRITE%%": "chat.write",
    "%%ADMIN%%": "chat.admin",
    "%%CMD%%": "krwn token mint",
  };
  const re = /(%%READ%%|%%WRITE%%|%%ADMIN%%|%%CMD%%)/;
  return template.split(re).map((chunk, idx) =>
    chunk in tokens ? (
      <code key={idx}>{tokens[chunk]}</code>
    ) : (
      <React.Fragment key={idx}>{chunk}</React.Fragment>
    ),
  );
}

// ------------------------------------------------------------

function PendingTray({
  count,
  onJump,
  items,
}: {
  count: number;
  onJump: (channelId: string) => void;
  items: ReturnType<typeof useChat>["pendingDirectives"];
}) {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-crown/40 bg-crown/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-2 text-left text-xs text-crown hover:bg-crown/10"
      >
        <DirectiveBadge />
        <span>
          {tp("chat.tray.items", count, {
            word: tp("chat.tray.word", count),
          })}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-widest">
          {open ? t("common.hide") : t("common.show")}
        </span>
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-crown/20 px-5 py-2">
          {items.map((p) => (
            <li
              key={p.ack.id}
              className="flex items-start gap-3 border-b border-border/40 py-2 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onJump(p.channel.id)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/70 hover:border-crown/60 hover:text-crown"
              >
                #{p.channel.title}
              </button>
              <div className="min-w-0 flex-1 text-xs text-foreground/80">
                <MarkdownText>{p.message.body}</MarkdownText>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

