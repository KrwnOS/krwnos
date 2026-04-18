import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WalletWidget } from "@/modules/wallet/components";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { I18nProvider } from "@/lib/i18n";
import { getServerLocale, getServerT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: t("app.title"),
    description: t("app.description"),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getServerLocale();
  const { t, meta } = await getServerT();

  return (
    <html lang={meta.bcp47} className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <I18nProvider initialLocale={locale}>
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
                  {t("app.brand")}
                </span>
              </Link>
              <div className="flex items-center gap-3">
                <LanguageSwitcher />
                <WalletWidget className="py-1.5" />
              </div>
            </div>
          </header>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
