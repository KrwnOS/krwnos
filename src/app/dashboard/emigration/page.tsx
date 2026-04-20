/**
 * Citizen emigration flow — explains `exitRefundRate` and executes POST /api/state/emigrate.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/components/wallet";
import { useI18n } from "@/lib/i18n";
import { splitEmigrationAmounts } from "@/lib/state-citizen";
import { cn } from "@/lib/utils";

const TOKEN_STORAGE_KEY = "krwn.token";
const LEGACY_WALLET_TOKEN_KEY = "krwn.cli_token";

const linkBtnOutline =
  "inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown";
const linkBtnGhost =
  "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown";
const linkBtnCrown =
  "inline-flex h-10 items-center justify-center rounded-md bg-crown px-4 text-sm font-medium text-black shadow-[0_0_24px_-6px_rgba(212,175,55,0.6)] transition-colors hover:bg-crown/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown";

interface SettingsDto {
  exitRefundRate: number;
  currencyDisplayName: string | null;
}

export default function EmigrationPage() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [currency, setCurrency] = useState("KRN");
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const primary = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    const legacy = window.localStorage.getItem(LEGACY_WALLET_TOKEN_KEY);
    setToken(primary ?? legacy);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [cRes, wRes, pRes] = await Promise.all([
        fetch("/api/state/constitution", {
          headers: { authorization: `Bearer ${token}` },
        }),
        fetch("/api/wallet/me", {
          headers: { authorization: `Bearer ${token}` },
        }),
        fetch("/api/state/pulse", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ]);
      if (!cRes.ok) throw new Error(`constitution ${cRes.status}`);
      if (!wRes.ok) throw new Error(`wallet ${wRes.status}`);
      if (!pRes.ok) throw new Error(`pulse ${pRes.status}`);
      const cBody = (await cRes.json()) as { settings: SettingsDto };
      const wBody = (await wRes.json()) as {
        wallet: { balance: unknown; currency: string };
      };
      const pBody = (await pRes.json()) as { viewer: { isOwner: boolean } };
      setSettings({
        exitRefundRate: cBody.settings.exitRefundRate,
        currencyDisplayName: cBody.settings.currencyDisplayName,
      });
      const bal =
        typeof wBody.wallet.balance === "number"
          ? wBody.wallet.balance
          : Number(wBody.wallet.balance);
      setBalance(Number.isFinite(bal) ? bal : 0);
      setCurrency(wBody.wallet.currency ?? "KRN");
      setIsOwner(pBody.viewer.isOwner);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const split = useMemo(() => {
    if (!settings) return null;
    return splitEmigrationAmounts(balance, settings.exitRefundRate, 18);
  }, [balance, settings]);

  const onConfirm = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/state/emigrate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_WALLET_TOKEN_KEY);
      setToken(null);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardTitle>{t("citizen.emigration.title")}</CardTitle>
          <CardDescription className="mt-2">
            {t("citizen.tokenRequired")}
          </CardDescription>
          <Link href="/dashboard" className={cn(linkBtnOutline, "mt-4")}>
            {t("citizen.backToPulse")}
          </Link>
        </Card>
      </main>
    );
  }

  if (done) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card className="border-crown/40 bg-crown/5">
          <CardTitle>{t("citizen.emigration.doneTitle")}</CardTitle>
          <CardDescription className="mt-2 whitespace-pre-line">
            {t("citizen.emigration.doneBody")}
          </CardDescription>
          <Link href="/" className={cn(linkBtnCrown, "mt-4")}>
            {t("citizen.emigration.home")}
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("citizen.emigration.kicker")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {t("citizen.emigration.title")}
          </h1>
        </div>
        <Link href="/dashboard" className={linkBtnGhost}>
          {t("citizen.backToPulse")}
        </Link>
      </div>

      {loading && (
        <Card>
          <CardDescription>{t("common.loading")}</CardDescription>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: error })}
        </Card>
      )}

      {!loading && settings && (
        <>
          {isOwner ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardTitle>{t("citizen.emigration.sovereignTitle")}</CardTitle>
              <CardDescription className="mt-2">
                {t("citizen.emigration.sovereignBody")}
              </CardDescription>
            </Card>
          ) : (
            <>
              <Card className="mb-4">
                <CardTitle>{t("citizen.emigration.previewTitle")}</CardTitle>
                <CardDescription className="mt-2">
                  {t("citizen.emigration.previewIntro")}
                </CardDescription>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground/60">
                      {t("citizen.emigration.rate")}
                    </dt>
                    <dd>{(settings.exitRefundRate * 100).toFixed(2)}%</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-foreground/60">
                      {t("citizen.emigration.balance")}
                    </dt>
                    <dd>
                      {formatAmount(balance)} {currency}
                    </dd>
                  </div>
                  {split && (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-foreground/60">
                          {t("citizen.emigration.kept")}
                        </dt>
                        <dd>
                          {formatAmount(split.kept)} {currency}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-foreground/60">
                          {t("citizen.emigration.forfeit")}
                        </dt>
                        <dd>
                          {formatAmount(split.forfeit)} {currency}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </Card>

              <Card className="mb-6">
                <CardTitle>{t("citizen.emigration.effectsTitle")}</CardTitle>
                <CardDescription className="mt-3 whitespace-pre-line">
                  {t("citizen.emigration.effectsBody")}
                </CardDescription>
              </Card>

              <Button
                variant="outline"
                className="border-destructive/60 text-destructive hover:bg-destructive/10"
                disabled={submitting}
                onClick={() => void onConfirm()}
              >
                {submitting
                  ? t("citizen.emigration.submitting")
                  : t("citizen.emigration.confirm")}
              </Button>
            </>
          )}
        </>
      )}
    </main>
  );
}
