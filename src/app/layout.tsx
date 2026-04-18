import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletWidget } from "@/modules/wallet/components";

export const metadata: Metadata = {
  title: "KrwnOS — Community Operating System",
  description:
    "Модульная операционная система для создания цифровых государств, компаний и сообществ.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
            <Link href="/" className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-md bg-crown font-bold text-black"
              >
                K
              </span>
              <span className="text-sm font-semibold tracking-wide">
                KrwnOS
              </span>
            </Link>
            <WalletWidget className="py-1.5" />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
