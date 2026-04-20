/**
 * ChatSidebar — вертикальный список каналов.
 *
 * Три логические группы согласно ТЗ:
 *   * Общие        — каналы без привязки к узлу (nodeId = null).
 *   * Мой отдел    — каналы узла, в котором пользователь состоит напрямую.
 *   * Прямые связи — каналы, доступные через ancestor-наследование
 *                    (т.е. узлы ниже по Вертикали, которыми пользователь
 *                    «надзирает»).
 *
 * Счётчик возле группы показывает число непрочитанных
 * директив в соответствующих каналах.
 */

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { ChannelAccessInfo, PendingDirective } from "../service";
import { groupChannels } from "./useChat";

interface ChatSidebarProps {
  channels: ChannelAccessInfo[];
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
  pendingDirectives: PendingDirective[];
}

export function ChatSidebar({
  channels,
  activeChannelId,
  onSelect,
  pendingDirectives,
}: ChatSidebarProps) {
  const t = useT();
  const groups = React.useMemo(() => groupChannels(channels), [channels]);
  const pendingByChannel = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pendingDirectives) {
      m.set(p.channel.id, (m.get(p.channel.id) ?? 0) + 1);
    }
    return m;
  }, [pendingDirectives]);

  return (
    <aside className="flex h-auto max-h-[min(42vh,320px)] w-full shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-b border-border/60 bg-background/80 p-3 text-sm touch-manipulation md:h-full md:max-h-none md:w-60 md:gap-4 md:overflow-visible md:border-b-0 md:border-r">
      <header className="flex items-center justify-between px-2 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/50">
          {t("chat.sidebar.channels")}
        </span>
        <span className="text-[10px] text-foreground/40">{channels.length}</span>
      </header>

      <Group
        title={t("chat.sidebar.general")}
        items={groups.general}
        empty={t("chat.sidebar.generalEmpty")}
        activeId={activeChannelId}
        onSelect={onSelect}
        pendingByChannel={pendingByChannel}
      />
      <Group
        title={t("chat.sidebar.department")}
        items={groups.department}
        empty={t("chat.sidebar.departmentEmpty")}
        activeId={activeChannelId}
        onSelect={onSelect}
        pendingByChannel={pendingByChannel}
      />
      <Group
        title={t("chat.sidebar.direct")}
        items={groups.direct}
        empty={t("chat.sidebar.directEmpty")}
        activeId={activeChannelId}
        onSelect={onSelect}
        pendingByChannel={pendingByChannel}
      />
      {groups.other.length > 0 && (
        <Group
          title={t("chat.sidebar.other")}
          items={groups.other}
          empty=""
          activeId={activeChannelId}
          onSelect={onSelect}
          pendingByChannel={pendingByChannel}
        />
      )}
    </aside>
  );
}

function Group({
  title,
  items,
  empty,
  activeId,
  onSelect,
  pendingByChannel,
}: {
  title: string;
  items: ChannelAccessInfo[];
  empty: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  pendingByChannel: Map<string, number>;
}) {
  const t = useT();
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
        {title}
      </h3>
      {items.length === 0 ? (
        empty ? (
          <p className="px-2 py-1 text-xs text-foreground/40">{empty}</p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((info) => {
            const active = info.channel.id === activeId;
            const pending = pendingByChannel.get(info.channel.id) ?? 0;
            return (
              <li key={info.channel.id}>
                <button
                  type="button"
                  onClick={() => onSelect(info.channel.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors md:min-h-0 md:py-1.5",
                    active
                      ? "bg-foreground/10 text-foreground"
                      : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
                  )}
                  aria-current={active ? "true" : undefined}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-foreground/40">#</span>
                    <span className="truncate">{info.channel.title}</span>
                    {info.canPostDirective && (
                      <span
                        title={t("chat.sidebar.canDirective")}
                        className="shrink-0 rounded-sm border border-crown/40 px-1 text-[9px] uppercase tracking-wider text-crown"
                      >
                        +
                      </span>
                    )}
                  </span>
                  {pending > 0 && (
                    <span className="shrink-0 rounded-full bg-crown/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                      {pending}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
