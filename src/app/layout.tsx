import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletWidget } from "@/modules/wallet/components";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { I18nProvider } from "@/lib/i18n";
import { getServerLocale, getServerT } from "@/lib/i18n/server";
import { ThemeProvider, ThemeStyleTag } from "@/core/providers/theme-provider";
import { loadActiveTheme } from "@/lib/theme-loader";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: t("app.title"),
    description: t("app.description"),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: t("app.brand"),
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: [
        {
          url: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          url: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
      apple: "/icons/icon-192.png",
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  const { t, meta } = await getServerT();
  // Theme Engine: pull the active State's themeConfig and SSR its
  // CSS variables into `<head>`. The client-side ThemeProvider will
  // re-render the same tag after hydration — no flash.
  const theme = await loadActiveTheme();

  return (
    <html lang={meta.bcp47} className="dark">
      <head>
        <ThemeStyleTag theme={theme} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ServiceWorkerRegister />
        <ThemeProvider initial={theme}>
          <I18nProvider initialLocale={locale}>
            <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-sm">
              <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:px-6 sm:py-0">
                <Link
                  href="/"
                  className="flex min-h-11 min-w-0 touch-manipulation items-center gap-2 rounded-md pr-2"
                >
                  <span
                    aria-hidden
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-crown font-bold text-black"
                  >
                    K
                  </span>
                  <span className="text-sm font-semibold tracking-wide">
                    {t("app.brand")}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                  <LanguageSwitcher />
                  <WalletWidget className="py-1.5" />
                </div>
              </div>
            </header>
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
