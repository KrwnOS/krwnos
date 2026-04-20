/**
 * Role market — `rolesPurchasable` + `citizenshipFeeAmount` from StateSettings,
 * node list from Pulse; purchase via POST /api/state/purchase-role.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/components/wallet";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TOKEN_STORAGE_KEY = "krwn.token";
const LEGACY_WALLET_TOKEN_KEY = "krwn.cli_token";

const linkBtnOutline =
  "inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown";
const linkBtnGhost =
  "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown";

interface SettingsDto {
  rolesPurchasable: boolean;
  citizenshipFeeAmount: number;
}

interface PulseNode {
  id: string;
  title: string;
  isLobby: boolean;
}

interface PulseBody {
  viewer: { isOwner: boolean; isLobbyOnly: boolean };
  wallet: { balance: number; currency: string } | null;
  tree: { nodes: PulseNode[] };
}

export default function RoleMarketPage() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [nodes, setNodes] = useState<PulseNode[]>([]);
  const [wallet, setWallet] = useState<PulseBody["wallet"]>(null);
  const [viewer, setViewer] = useState<PulseBody["viewer"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

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
      const [cRes, pRes] = await Promise.all([
        fetch("/api/state/constitution", {
          headers: { authorization: `Bearer ${token}` },
        }),
        fetch("/api/state/pulse", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ]);
      if (!cRes.ok) throw new Error(`constitution ${cRes.status}`);
      if (!pRes.ok) throw new Error(`pulse ${pRes.status}`);
      const cBody = (await cRes.json()) as { settings: SettingsDto };
      const pBody = (await pRes.json()) as PulseBody;
      setSettings({
        rolesPurchasable: cBody.settings.rolesPurchasable,
        citizenshipFeeAmount: cBody.settings.citizenshipFeeAmount,
      });
      setNodes(pBody.tree.nodes.filter((n) => !n.isLobby));
      setWallet(pBody.wallet);
      setViewer(pBody.viewer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const purchase = async (targetNodeId: string) => {
    if (!token) return;
    setBusyId(targetNodeId);
    setError(null);
    setSuccessId(null);
    try {
      const res = await fetch("/api/state/purchase-role", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetNodeId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSuccessId(targetNodeId);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!token) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardTitle>{t("citizen.roleMarket.title")}</CardTitle>
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

  const fee = settings?.citizenshipFeeAmount ?? 0;
  const purchasable = settings?.rolesPurchasable === true;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("citizen.roleMarket.kicker")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {t("citizen.roleMarket.title")}
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
          {viewer?.isOwner ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardTitle>{t("citizen.roleMarket.sovereignTitle")}</CardTitle>
              <CardDescription className="mt-2">
                {t("citizen.roleMarket.sovereignBody")}
              </CardDescription>
            </Card>
          ) : !purchasable ? (
            <Card>
              <CardTitle>{t("citizen.roleMarket.offTitle")}</CardTitle>
              <CardDescription className="mt-2 whitespace-pre-line">
                {t("citizen.roleMarket.offBody")}
              </CardDescription>
            </Card>
          ) : (
            <>
              <Card className="mb-4">
                <CardTitle>{t("citizen.roleMarket.priceTitle")}</CardTitle>
                <CardDescription className="mt-2">
                  {t("citizen.roleMarket.priceBody", {
                    amount: formatAmount(fee),
                    currency: wallet?.currency ?? "KRN",
                  })}
                </CardDescription>
                {wallet && (
                  <p className="mt-3 text-sm text-foreground/70">
                    {t("citizen.roleMarket.yourBalance", {
                      amount: formatAmount(wallet.balance),
                      currency: wallet.currency,
                    })}
                  </p>
                )}
              </Card>

              <Card className="mb-4">
                <CardTitle>{t("citizen.roleMarket.nodesTitle")}</CardTitle>
                <CardDescription className="mt-2">
                  {t("citizen.roleMarket.nodesHint")}
                </CardDescription>
                <ul className="mt-4 space-y-2">
                  {nodes.length === 0 ? (
                    <li className="text-sm text-foreground/50">
                      {t("citizen.roleMarket.noNodes")}
                    </li>
                  ) : (
                    nodes.map((n) => (
                      <li
                        key={n.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                      >
                        <span className="font-medium">{n.title}</span>
                        <Button
                          size="sm"
                          variant="crown"
                          disabled={busyId !== null}
                          onClick={() => void purchase(n.id)}
                        >
                          {busyId === n.id
                            ? t("common.loadingDots")
                            : successId === n.id
                              ? t("citizen.roleMarket.purchased")
                              : t("citizen.roleMarket.buy")}
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </Card>

              {viewer && !viewer.isLobbyOnly && (
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardDescription>
                    {t("citizen.roleMarket.notLobbyOnly")}
                  </CardDescription>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
