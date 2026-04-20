"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const ChatPanel = dynamic(
  () => import("@/modules/chat/components").then((m) => m.ChatPanel),
  { ssr: false, loading: () => <ChatPanelFallback /> },
);

const PILLAR_KEYS = ["state", "vertical", "kernel", "modules"] as const;

export function HomeClient() {
  const t = useT();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="relative min-h-screen">
      <main
        className={cn(
          "mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-12 transition-[margin] duration-300 sm:px-6 sm:py-16",
          chatOpen && "lg:mr-[420px]",
        )}
      >
        <header className="flex items-center justify-end">
          <nav className="flex max-w-full flex-wrap items-center justify-end gap-2">
            <Link href="/docs/ARCHITECTURE">
              <Button variant="ghost" size="sm">
                {t("common.docs")}
              </Button>
            </Link>
            <Button
              variant={chatOpen ? "outline" : "ghost"}
              size="sm"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
            >
              {chatOpen ? t("home.chat.close") : t("home.chat.open")}
            </Button>
            <Link href="/setup">
              <Button variant="crown" size="sm">
                {t("home.cta.coronate")}
              </Button>
            </Link>
          </nav>
        </header>

        <section className="mt-24 flex flex-col items-start gap-6">
          <span className="rounded-full border border-crown/40 px-3 py-1 text-xs uppercase tracking-widest text-crown">
            {t("home.hero.eyebrow")}
          </span>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl md:text-6xl">
            {t("home.hero.titlePre")}{" "}
            <span className="text-crown">{t("home.hero.titleCrown")}</span>
          </h1>
          <p className="max-w-2xl text-lg text-foreground/70">
            {t("home.hero.body")}
          </p>
          <div className="mt-2 flex gap-3">
            <Link href="/setup">
              <Button variant="crown" size="lg">
                {t("home.hero.createState")}
              </Button>
            </Link>
            <Link href="/docs/MODULE_GUIDE">
              <Button variant="outline" size="lg">
                {t("home.hero.buildModule")}
              </Button>
            </Link>
          </div>
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-2">
          {PILLAR_KEYS.map((key) => (
            <Card key={key}>
              <CardTitle>{t(`home.pillar.${key}.title`)}</CardTitle>
              <CardDescription>
                {t(`home.pillar.${key}.desc`)}
              </CardDescription>
            </Card>
          ))}
        </section>

        <footer className="mt-24 border-t border-border/60 pt-6 text-sm text-foreground/50">
          {t("home.footer.mvp")}{" "}
          <Link href="/" className="text-crown hover:underline">
            {t("home.footer.roadmap")}
          </Link>
          .
        </footer>
      </main>

      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] right-[max(1.5rem,env(safe-area-inset-right,0px))] z-40 flex min-h-12 touch-manipulation items-center gap-2 rounded-full border border-crown/60 bg-background/90 px-4 text-sm font-semibold text-crown shadow-[0_0_24px_-6px_rgba(212,175,55,0.5)] backdrop-blur hover:bg-crown hover:text-black"
        >
          <span aria-hidden>◈</span> {t("home.chat.float")}
        </button>
      )}

      <ChatSidePanel open={chatOpen} onClose={() => setChatOpen(false)}>
        <ChatPanel className="h-full rounded-none border-0" />
      </ChatSidePanel>
    </div>
  );
}

function ChatSidePanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <>
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
          "fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-border/70 bg-background pt-[env(safe-area-inset-top,0px)] shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 sm:px-4">
          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-widest text-crown">
            {t("home.sidepanel.label")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-md text-sm text-foreground/60 hover:bg-foreground/10"
          >
            {t("common.closeX")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom,0px)]">
          {children}
        </div>
      </aside>
    </>
  );
}

function ChatPanelFallback() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center text-xs text-foreground/50">
      {t("home.chat.preparing")}
    </div>
  );
}
