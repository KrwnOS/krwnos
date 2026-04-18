/**
 * ChatWindow — основное окно переписки.
 *
 * Что делает:
 *   * Рендерит ленту сообщений выбранного канала (Markdown, директивы).
 *   * Показывает баннер «Требует подтверждения» для входящих приказов,
 *     которые именно *этот* пользователь ещё не принял.
 *   * Поле ввода снизу с тумблером «Отправить как Приказ» — тумблер
 *     видим только когда `canPostDirective` канала равен `true`.
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ChannelAccessInfo,
  ChatMessage,
  PendingDirective,
} from "../service";
import { DirectiveBadge } from "./DirectiveBadge";
import { MarkdownText } from "./markdown";

interface ChatWindowProps {
  channel: ChannelAccessInfo | null;
  messages: ChatMessage[];
  currentUserId: string | null;
  pendingDirectives: PendingDirective[];
  onSend: (body: string, asDirective: boolean) => Promise<void>;
  onAcknowledge: (messageId: string) => Promise<void>;
}

export function ChatWindow({
  channel,
  messages,
  currentUserId,
  pendingDirectives,
  onSend,
  onAcknowledge,
}: ChatWindowProps) {
  if (!channel) {
    return (
      <section className="flex h-full flex-1 items-center justify-center text-sm text-foreground/50">
        Выберите канал слева — или создайте новый через `chat.admin`.
      </section>
    );
  }

  return (
    <section className="flex h-full flex-1 flex-col">
      <Header channel={channel} />
      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        pendingDirectives={pendingDirectives}
        onAcknowledge={onAcknowledge}
      />
      <Composer
        canPostDirective={channel.canPostDirective}
        onSend={onSend}
        channelTitle={channel.channel.title}
      />
    </section>
  );
}

// ------------------------------------------------------------

function Header({ channel }: { channel: ChannelAccessInfo }) {
  const sub = subtitleForAccessReason(channel);
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
      <div className="flex flex-col">
        <h2 className="text-base font-semibold text-foreground">
          # {channel.channel.title}
        </h2>
        {channel.channel.topic && (
          <p className="text-xs text-foreground/60">{channel.channel.topic}</p>
        )}
      </div>
      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground/50">
        {sub}
      </span>
    </header>
  );
}

function subtitleForAccessReason(info: ChannelAccessInfo): string {
  switch (info.accessReason) {
    case "sovereign":
      return "Суверен";
    case "direct":
      return "Мой отдел";
    case "inherited":
      return "Надзор";
    default:
      return "Общий";
  }
}

// ------------------------------------------------------------

function MessageList({
  messages,
  currentUserId,
  pendingDirectives,
  onAcknowledge,
}: {
  messages: ChatMessage[];
  currentUserId: string | null;
  pendingDirectives: PendingDirective[];
  onAcknowledge: (messageId: string) => Promise<void>;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Scroll-to-bottom on new messages. We only scroll if the user is
  // already near the bottom so they can read history without the page
  // yanking away.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pendingForMe = useMemo(() => {
    const s = new Set<string>();
    for (const p of pendingDirectives) s.add(p.message.id);
    return s;
  }, [pendingDirectives]);

  return (
    <div
      ref={scrollerRef}
      className="flex-1 overflow-y-auto px-5 py-4"
    >
      {messages.length === 0 ? (
        <p className="text-sm text-foreground/40">
          Пока сообщений нет. Будьте первым.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              isOwn={m.authorId === currentUserId}
              requiresAck={pendingForMe.has(m.id)}
              onAcknowledge={onAcknowledge}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({
  message,
  isOwn,
  requiresAck,
  onAcknowledge,
}: {
  message: ChatMessage;
  isOwn: boolean;
  requiresAck: boolean;
  onAcknowledge: (messageId: string) => Promise<void>;
}) {
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  const handleAck = async () => {
    setAcking(true);
    setAckError(null);
    try {
      await onAcknowledge(message.id);
    } catch (err) {
      setAckError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setAcking(false);
    }
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-transparent p-3",
        message.isDirective && requiresAck
          ? "border-crown/50 bg-crown/5"
          : message.isDirective
            ? "border-border bg-muted/30"
            : "hover:bg-foreground/[0.03]",
      )}
    >
      <header className="flex items-center gap-2 text-xs text-foreground/60">
        <span className={cn("font-medium", isOwn && "text-crown")}>
          {isOwn ? "вы" : shortId(message.authorId)}
        </span>
        {message.isDirective && (
          <DirectiveBadge acknowledged={!requiresAck && !isOwn} />
        )}
        <time className="ml-auto text-[10px] text-foreground/40">
          {formatTime(message.createdAt)}
        </time>
      </header>

      <div className="text-foreground/90">
        <MarkdownText>{message.body}</MarkdownText>
      </div>

      {message.isDirective && requiresAck && !isOwn && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-background/60 p-2">
          <span className="text-xs text-foreground/70">
            Требуется подтверждение выполнения.
          </span>
          <button
            type="button"
            onClick={handleAck}
            disabled={acking}
            className="ml-auto rounded-md bg-crown px-3 py-1 text-xs font-semibold text-black shadow transition hover:bg-crown/90 disabled:opacity-60"
          >
            {acking ? "..." : "Принято к исполнению"}
          </button>
        </div>
      )}
      {ackError && (
        <p className="mt-1 text-[11px] text-red-400">{ackError}</p>
      )}
    </li>
  );
}

// ------------------------------------------------------------

function Composer({
  canPostDirective,
  onSend,
  channelTitle,
}: {
  canPostDirective: boolean;
  onSend: (body: string, asDirective: boolean) => Promise<void>;
  channelTitle: string;
}) {
  const [value, setValue] = useState("");
  const [asDirective, setAsDirective] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSend(body, asDirective && canPostDirective);
      setValue("");
      setAsDirective(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <footer className="border-t border-border/60 bg-background/70 p-3">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border border-border/60 p-2 transition-colors",
          asDirective && "border-crown/60 shadow-[0_0_0_1px_rgba(212,175,55,0.35)_inset]",
        )}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            asDirective
              ? `Приказ в #${channelTitle}… (Markdown поддерживается)`
              : `Сообщение в #${channelTitle}… (Markdown поддерживается)`
          }
          rows={2}
          className="min-h-[44px] w-full resize-none bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
          disabled={busy}
        />

        <div className="flex items-center gap-2">
          {canPostDirective && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground/70">
              <input
                type="checkbox"
                checked={asDirective}
                onChange={(e) => setAsDirective(e.target.checked)}
                className="h-3.5 w-3.5 accent-crown"
                disabled={busy}
              />
              <DirectiveBadge className="pointer-events-none" />
            </label>
          )}
          {err && <span className="text-xs text-red-400">{err}</span>}
          <button
            type="button"
            onClick={submit}
            disabled={busy || value.trim().length === 0}
            className={cn(
              "ml-auto rounded-md px-3 py-1.5 text-xs font-semibold transition",
              asDirective
                ? "bg-crown text-black hover:bg-crown/90"
                : "bg-foreground text-background hover:bg-foreground/90",
              "disabled:opacity-50",
            )}
          >
            {asDirective ? "Издать приказ" : "Отправить"}
          </button>
        </div>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------

function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 6)}…${id.slice(-2)}`;
}

function formatTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
