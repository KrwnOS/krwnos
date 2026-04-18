"use client";

/**
 * Compact, dependency-free language picker.
 * ------------------------------------------------------------
 * Renders one pill per available locale; the active one is
 * highlighted with the `crown` accent color that the rest of
 * KrwnOS already uses for "selected / authoritative" state.
 * Uses `aria-pressed` instead of a real select so it stays
 * keyboard-friendly without any popover machinery.
 *
 * If only one locale is configured, renders nothing — avoids
 * cluttering the header while a translation is being prepared.
 */

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  /** "pill" (default, header) or "inline" (settings rows). */
  variant?: "pill" | "inline";
}

export function LanguageSwitcher({ className, variant = "pill" }: Props) {
  const { locale, setLocale, availableLocales, t } = useI18n();

  if (availableLocales.length < 2) return null;

  return (
    <div
      role="group"
      aria-label={t("language.switcher.label")}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 p-0.5",
        variant === "inline" && "border-transparent bg-transparent p-0 gap-2",
        className,
      )}
    >
      {availableLocales.map((meta) => {
        const active = meta.code === locale;
        return (
          <button
            key={meta.code}
            type="button"
            onClick={() => setLocale(meta.code)}
            aria-pressed={active}
            title={meta.nativeName}
            className={cn(
              "rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown",
              active
                ? "bg-crown text-black"
                : "text-foreground/70 hover:text-foreground",
            )}
          >
            {meta.code}
          </button>
        );
      })}
    </div>
  );
}
