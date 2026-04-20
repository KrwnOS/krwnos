"use client";

/**
 * First-run checklist for Sovereign / `state.configure` after bootstrap.
 * Completion is persisted server-side (`StateSettings.extras`).
 */

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TOKEN_STORAGE_KEY = "krwn.token";

export interface SovereignOnboardingTourProps {
  open: boolean;
  /** User chose «Later» or clicked the backdrop — snooze for this browser tab session. */
  onSnooze: () => void;
  onCompleted: () => void;
}

export function SovereignOnboardingTour({
  open,
  onSnooze,
  onCompleted,
}: SovereignOnboardingTourProps) {
  const { t } = useI18n();
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, trapRef, { onEscape: onSnooze });

  const complete = useCallback(async () => {
    if (typeof window === "undefined") return;
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setError(t("sovereignOnboarding.errNoToken"));
      return;
    }
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch("/api/state/sovereign-onboarding/complete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDismissing(false);
    }
  }, [onCompleted, t]);

  if (!open) return null;

  const steps: { href: string; title: string; body: string }[] = [
    {
      href: "/admin/nexus#nexus-economy-treasury",
      title: t("sovereignOnboarding.step.treasury.title"),
      body: t("sovereignOnboarding.step.treasury.body"),
    },
    {
      href: "/admin/economy#admin-economy-primary",
      title: t("sovereignOnboarding.step.currency.title"),
      body: t("sovereignOnboarding.step.currency.body"),
    },
    {
      href: "/admin/citizens#admin-citizens",
      title: t("sovereignOnboarding.step.citizens.title"),
      body: t("sovereignOnboarding.step.citizens.body"),
    },
    {
      href: "/admin/constitution#constitution-fiscal",
      title: t("sovereignOnboarding.step.taxes.title"),
      body: t("sovereignOnboarding.step.taxes.body"),
    },
    {
      href: "/governance",
      title: t("sovereignOnboarding.step.parliament.title"),
      body: t("sovereignOnboarding.step.parliament.body"),
    },
  ];

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sovereign-onboarding-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm motion-reduce:transition-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSnooze();
      }}
    >
      <Card className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto border-crown/40 shadow-2xl shadow-crown/10">
        <p className="text-[10px] uppercase tracking-[0.3em] text-crown">
          {t("sovereignOnboarding.eyebrow")}
        </p>
        <CardTitle id="sovereign-onboarding-title" className="mt-2">
          {t("sovereignOnboarding.title")}
        </CardTitle>
        <CardDescription className="mt-2">
          {t("sovereignOnboarding.subtitle")}
        </CardDescription>

        <ol className="mt-6 space-y-3">
          {steps.map((s, i) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className={cn(
                  "flex gap-3 rounded-lg border border-border/60 bg-background/40 p-3 transition-colors",
                  "hover:border-crown/50 hover:bg-crown/5",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-crown/40 bg-crown/10 text-xs font-semibold text-crown"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {s.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-foreground/60">
                    {s.body}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        {error && (
          <p className="mt-4 text-sm text-destructive">
            {t("common.errorWith", { message: error })}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSnooze}
            disabled={dismissing}
          >
            {t("sovereignOnboarding.later")}
          </Button>
          <Button
            type="button"
            variant="crown"
            size="sm"
            onClick={() => void complete()}
            disabled={dismissing}
          >
            {dismissing
              ? t("common.saving")
              : t("sovereignOnboarding.done")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
