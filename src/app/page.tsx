"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The chat panel is a client-only bundle (localStorage, EventSource).
// Loading it lazily keeps the marketing page lightweight and makes SSR
// safe regardless of what `useChat` does on mount.
const ChatPanel = dynamic(
  () => import("@/modules/chat/components").then((m) => m.ChatPanel),
  { ssr: false, loading: () => <ChatPanelFallback /> },
);

const pillars = [
  {
    title: "The State",
    desc: "Изолированный инстанс со своим Сувереном, правилами и набором установленных модулей.",
  },
  {
    title: "The Vertical",
    desc: "Графовая структура власти. Полномочия наследуются и ветвятся сверху вниз.",
  },
  {
    title: "The Kernel",
    desc: "Auth, Permissions, Event Bus и Registry — минимальный набор сервисов ядра.",
  },
  {
    title: "The Modules",
    desc: "Чат, Казначейство, Задачи, Голосования — плагины, расширяющие государство.",
  },
];

export default function HomePage() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="relative min-h-screen">
      <main
        className={cn(
          "mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-16 transition-[margin] duration-300",
          chatOpen && "lg:mr-[420px]",
        )}
      >
        <header className="flex items-center justify-end">
          <nav className="flex items-center gap-2">
            <Link href="/docs/ARCHITECTURE">
              <Button variant="ghost" size="sm">
                Docs
              </Button>
            </Link>
            <Button
              variant={chatOpen ? "outline" : "ghost"}
              size="sm"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
            >
              {chatOpen ? "Скрыть чат" : "Открыть чат"}
            </Button>
            <Button variant="crown" size="sm">
              Coronate
            </Button>
          </nav>
        </header>

        <section className="mt-24 flex flex-col items-start gap-6">
          <span className="rounded-full border border-crown/40 px-3 py-1 text-xs uppercase tracking-widest text-crown">
            Community OS
          </span>
          <h1 className="text-5xl font-semibold leading-tight md:text-6xl">
            Построй своё{" "}
            <span className="text-crown">цифровое государство.</span>
          </h1>
          <p className="max-w-2xl text-lg text-foreground/70">
            KrwnOS — модульная операционная система для создания и управления
            сообществами, компаниями и кланами. Суверен собирает Вертикаль
            власти, подключает плагины и раздаёт права вниз по иерархии.
          </p>
          <div className="mt-2 flex gap-3">
            <Button variant="crown" size="lg">
              Создать State
            </Button>
            <Link href="/docs/MODULE_GUIDE">
              <Button variant="outline" size="lg">
                Разработать модуль
              </Button>
            </Link>
          </div>
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-2">
          {pillars.map((p) => (
            <Card key={p.title}>
              <CardTitle>{p.title}</CardTitle>
              <CardDescription>{p.desc}</CardDescription>
            </Card>
          ))}
        </section>

        <footer className="mt-24 border-t border-border/60 pt-6 text-sm text-foreground/50">
          MVP — Phase 1 Foundation. See{" "}
          <Link href="/" className="text-crown hover:underline">
            ROADMAP
          </Link>
          .
        </footer>
      </main>

      {/* Floating toggle that's always reachable on mobile. */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-crown/60 bg-background/90 px-4 py-2 text-sm font-semibold text-crown shadow-[0_0_24px_-6px_rgba(212,175,55,0.5)] backdrop-blur hover:bg-crown hover:text-black"
        >
          <span aria-hidden>◈</span> Чат
        </button>
      )}

      <ChatSidePanel open={chatOpen} onClose={() => setChatOpen(false)}>
        <ChatPanel className="h-full rounded-none border-0" />
      </ChatSidePanel>
    </div>
  );
}

// ------------------------------------------------------------

function ChatSidePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Backdrop: shown only below `lg` so desktop keeps the doc readable. */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-border/70 bg-background shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-crown">
            Core.Chat
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-foreground/60 hover:bg-foreground/10"
          >
            Закрыть ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </>
  );
}

function ChatPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-foreground/50">
      Подготавливаем канал связи…
    </div>
  );
}
