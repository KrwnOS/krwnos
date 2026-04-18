"use client";

/**
 * WalletNavbar — top-bar widget wiring WalletCard + TransferModal.
 * ------------------------------------------------------------
 * Drops into any layout that has an authenticated user. Fetches
 * the caller's wallet from `/api/wallet/me` on mount and exposes a
 * "Перевести" button that opens the transfer modal.
 *
 * Auth: uses a CLI bearer token the client obtains via setup /
 * cli token flow — in dev you can pass it via `?cli_token=…` or
 * drop it into `localStorage("krwn.cli_token")`. Production will
 * replace this hook with proper session cookies.
 */

import * as React from "react";
import { WalletCard } from "./WalletCard";
import { TransferModal } from "./TransferModal";
import type { TransactionDto, WalletDto } from "./types";

interface MeResponse {
  wallet: WalletDto;
  transactions: TransactionDto[];
}

interface TreasuriesResponse {
  treasuries: WalletDto[];
}

export interface WalletNavbarProps {
  className?: string;
  /**
   * Optional override; when omitted the component reads
   * `localStorage.krwn_cli_token` on the client.
   */
  authToken?: string;
}

export function WalletNavbar({
  className,
  authToken,
}: WalletNavbarProps): React.ReactElement | null {
  const [wallet, setWallet] = React.useState<WalletDto | null>(null);
  const [treasuries, setTreasuries] = React.useState<WalletDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);

  // Resolve auth token on the client.
  React.useEffect(() => {
    if (authToken) {
      setToken(authToken);
      return;
    }
    try {
      const stored = window.localStorage.getItem("krwn_cli_token");
      setToken(stored);
    } catch {
      setToken(null);
    }
  }, [authToken]);

  const load = React.useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [meRes, treRes] = await Promise.all([
        fetch("/api/wallet/me", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch("/api/wallet/treasuries", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      if (meRes.ok) {
        const data = (await meRes.json()) as MeResponse;
        setWallet(data.wallet);
      } else {
        setWallet(null);
      }
      if (treRes.ok) {
        const data = (await treRes.json()) as TreasuriesResponse;
        setTreasuries(data.treasuries);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!token) {
    return (
      <div className={className}>
        <span className="text-xs text-foreground/40">Wallet offline</span>
      </div>
    );
  }
  if (loading && !wallet) {
    return (
      <div className={className}>
        <span className="text-xs text-foreground/40">Загрузка…</span>
      </div>
    );
  }
  if (!wallet) {
    return (
      <div className={className}>
        <span className="text-xs text-foreground/40">Нет кошелька</span>
      </div>
    );
  }

  return (
    <>
      <div className={className}>
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          className="block"
          title="Открыть перевод"
        >
          <WalletCard wallet={wallet} variant="compact" />
        </button>
      </div>

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={() => void load()}
        personal={wallet}
        treasuries={treasuries.map((t) => ({
          wallet: t,
          label:
            (t.metadata?.nodeTitle as string | undefined) ??
            `Казна · ${t.nodeId?.slice(0, 8)}`,
        }))}
        authToken={token}
      />
    </>
  );
}
