import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";

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
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-crown text-black font-bold">
            K
          </div>
          <span className="font-semibold tracking-wide">KrwnOS</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/docs/ARCHITECTURE">
            <Button variant="ghost" size="sm">
              Docs
            </Button>
          </Link>
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
  );
}
