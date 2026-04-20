/**
 * `/admin/constitution` — Палата Указов (Sovereign's Decree).
 * ------------------------------------------------------------
 * Витрина для Суверена, где он программирует государство
 * целиком: фискальная политика, правила входа/выхода, динамика
 * Вертикали, Парламент. Формирует один PATCH-запрос в
 * `/api/state/constitution` при нажатии «Подписать указ».
 *
 * Все строки переведены через i18n: ключи живут под
 * `constitution.*`, подписи пунктов whitelist'а Парламента —
 * под `constitution.keys.<fieldName>`.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n, type LocaleCode } from "@/lib/i18n";

type TreasuryTransparency = "public" | "council" | "sovereign";
type GovernanceMode = "decree" | "consultation" | "auto_dao";
type WeightStrategy =
  | "one_person_one_vote"
  | "by_node_weight"
  | "by_balance";

interface GovernanceRulesDto {
  mode: GovernanceMode;
  sovereignVeto: boolean;
  quorumBps: number;
  thresholdBps: number;
  votingDurationSeconds: number;
  weightStrategy: WeightStrategy;
  nodeWeights: Record<string, number>;
  balanceAssetId: string | null;
  minProposerPermission: string | null;
  minProposerBalance: number | null;
  allowedConfigKeys: string[];
}

interface StateSettingsDto {
  id: string;
  stateId: string;
  uiLocale: string | null;
  transactionTaxRate: number;
  incomeTaxRate: number;
  roleTaxRate: number;
  payrollEnabled: boolean;
  payrollAmountPerCitizen: number;
  currencyDisplayName: string | null;
  citizenshipFeeAmount: number;
  rolesPurchasable: boolean;
  exitRefundRate: number;
  permissionInheritance: boolean;
  autoPromotionEnabled: boolean;
  autoPromotionMinBalance: number | null;
  autoPromotionMinDays: number | null;
  autoPromotionTargetNodeId: string | null;
  treasuryTransparency: TreasuryTransparency;
  governanceRules: GovernanceRulesDto;
}

// Keys the Sovereign can expose to the Parliament. The label
// for each one is looked up via `constitution.keys.<key>` so
// every locale can translate it independently.
const GOVERNANCE_MANAGEABLE_KEYS: ReadonlyArray<string> = [
  "transactionTaxRate",
  "incomeTaxRate",
  "roleTaxRate",
  "payrollEnabled",
  "payrollAmountPerCitizen",
  "currencyDisplayName",
  "citizenshipFeeAmount",
  "rolesPurchasable",
  "exitRefundRate",
  "permissionInheritance",
  "autoPromotionEnabled",
  "autoPromotionMinBalance",
  "autoPromotionMinDays",
  "autoPromotionTargetNodeId",
  "treasuryTransparency",
  "walletFine",
];

interface FormState {
  transactionTaxPct: string;
  incomeTaxPct: string;
  roleTaxPct: string;
  payrollEnabled: boolean;
  payrollAmountPerCitizen: string;
  currencyDisplayName: string;
  citizenshipFeeAmount: string;
  rolesPurchasable: boolean;
  exitRefundPct: string;
  permissionInheritance: boolean;
  autoPromotionEnabled: boolean;
  autoPromotionMinBalance: string;
  autoPromotionMinDays: string;
  autoPromotionTargetNodeId: string;
  treasuryTransparency: TreasuryTransparency;

  governanceMode: GovernanceMode;
  governanceSovereignVeto: boolean;
  governanceQuorumPct: string;
  governanceThresholdPct: string;
  governanceDurationDays: string;
  governanceWeightStrategy: WeightStrategy;
  governanceMinProposerBalance: string;
  governanceAllowedKeys: Record<string, boolean>;

  uiLocale: string;
}

const TOKEN_STORAGE_KEY = "krwn.token";

function toForm(settings: StateSettingsDto): FormState {
  const g = settings.governanceRules;
  const wildcard = g.allowedConfigKeys.includes("*");
  const allowedSet = new Set(g.allowedConfigKeys);
  const allowed: Record<string, boolean> = {};
  for (const key of GOVERNANCE_MANAGEABLE_KEYS) {
    allowed[key] = wildcard || allowedSet.has(key);
  }
  return {
    uiLocale: settings.uiLocale ?? "en",
    transactionTaxPct: (settings.transactionTaxRate * 100).toString(),
    incomeTaxPct: (settings.incomeTaxRate * 100).toString(),
    roleTaxPct: (settings.roleTaxRate * 100).toString(),
    payrollEnabled: settings.payrollEnabled,
    payrollAmountPerCitizen: settings.payrollAmountPerCitizen.toString(),
    currencyDisplayName: settings.currencyDisplayName ?? "",
    citizenshipFeeAmount: settings.citizenshipFeeAmount.toString(),
    rolesPurchasable: settings.rolesPurchasable,
    exitRefundPct: (settings.exitRefundRate * 100).toString(),
    permissionInheritance: settings.permissionInheritance,
    autoPromotionEnabled: settings.autoPromotionEnabled,
    autoPromotionMinBalance:
      settings.autoPromotionMinBalance === null
        ? ""
        : settings.autoPromotionMinBalance.toString(),
    autoPromotionMinDays:
      settings.autoPromotionMinDays === null
        ? ""
        : settings.autoPromotionMinDays.toString(),
    autoPromotionTargetNodeId: settings.autoPromotionTargetNodeId ?? "",
    treasuryTransparency: settings.treasuryTransparency,

    governanceMode: g.mode,
    governanceSovereignVeto: g.sovereignVeto,
    governanceQuorumPct: (g.quorumBps / 100).toString(),
    governanceThresholdPct: (g.thresholdBps / 100).toString(),
    governanceDurationDays: (
      g.votingDurationSeconds / 86_400
    ).toString(),
    governanceWeightStrategy: g.weightStrategy,
    governanceMinProposerBalance:
      g.minProposerBalance === null ? "" : g.minProposerBalance.toString(),
    governanceAllowedKeys: allowed,
  };
}

export default function AdminConstitutionPage() {
  const { t, availableLocales } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<StateSettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/state/constitution", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as
        | { settings: StateSettingsDto }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : `HTTP ${res.status}`,
        );
      }
      if ("settings" in payload) {
        setSettings(payload.settings);
        setForm(toForm(payload.settings));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setSettings(null);
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty = useMemo(() => {
    if (!settings || !form) return false;
    return JSON.stringify(toForm(settings)) !== JSON.stringify(form);
  }, [settings, form]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !form) return;
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const body = buildPatch(form);
      const res = await fetch("/api/state/constitution", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as
        | { settings: StateSettingsDto }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload
            ? typeof payload.error === "string"
              ? payload.error
              : JSON.stringify(payload.error)
            : `HTTP ${res.status}`,
        );
      }
      if ("settings" in payload) {
        setSettings(payload.settings);
        setForm(toForm(payload.settings));
        setFlash(t("constitution.signed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <Shell>
        <TokenPrompt
          onSubmit={(next) => {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
            setToken(next);
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("constitution.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {t("constitution.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("constitution.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? t("common.loadingDots") : t("common.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.localStorage.removeItem(TOKEN_STORAGE_KEY);
              setToken(null);
              setSettings(null);
              setForm(null);
            }}
          >
            {t("common.logout")}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: error })}
          {t("constitution.errorHint", { perm: "state.configure" })}
        </Card>
      )}

      {flash && (
        <Card className="mb-6 border-crown/40 bg-crown/5 text-sm text-crown">
          {flash}
        </Card>
      )}

      {!form && !error && (
        <Card className="text-sm text-foreground/60">
          {t("constitution.loading")}
        </Card>
      )}

      {form && (
        <form className="space-y-6" onSubmit={onSubmit}>
          <Section
            id="constitution-locale"
            eyebrow={t("constitution.locale.eyebrow")}
            title={t("constitution.locale.title")}
            description={t("constitution.locale.desc")}
          >
            <SelectField
              label={t("constitution.locale.field")}
              hint={t("constitution.locale.hint")}
              value={form.uiLocale}
              onChange={(v) =>
                setForm({ ...form, uiLocale: v as LocaleCode })
              }
              options={availableLocales.map((m) => ({
                value: m.code,
                label: `${m.nativeName} (${m.code})`,
              }))}
            />
          </Section>

          <Section
            id="constitution-fiscal"
            eyebrow={t("constitution.ch1.eyebrow")}
            title={t("constitution.ch1.title")}
            description={t("constitution.ch1.desc")}
          >
            <Grid3>
              <NumberField
                label={t("constitution.ch1.transferTax")}
                hint={t("constitution.ch1.transferTaxHint")}
                value={form.transactionTaxPct}
                onChange={(v) => setForm({ ...form, transactionTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <NumberField
                label={t("constitution.ch1.incomeTax")}
                hint={t("constitution.ch1.incomeTaxHint")}
                value={form.incomeTaxPct}
                onChange={(v) => setForm({ ...form, incomeTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <NumberField
                label={t("constitution.ch1.roleTax")}
                hint={t("constitution.ch1.roleTaxHint")}
                value={form.roleTaxPct}
                onChange={(v) => setForm({ ...form, roleTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <ToggleField
                label={t("constitution.ch1.payrollEnabled")}
                hint={t("constitution.ch1.payrollEnabledHint")}
                checked={form.payrollEnabled}
                onChange={(v) => setForm({ ...form, payrollEnabled: v })}
              />
              <NumberField
                label={t("constitution.ch1.payrollAmount")}
                hint={t("constitution.ch1.payrollAmountHint")}
                value={form.payrollAmountPerCitizen}
                onChange={(v) =>
                  setForm({ ...form, payrollAmountPerCitizen: v })
                }
                min={0}
                step={0.01}
              />
            </Grid3>
            <div className="mt-4">
              <TextField
                label={t("constitution.ch1.display")}
                hint={t("constitution.ch1.displayHint")}
                value={form.currencyDisplayName}
                onChange={(v) => setForm({ ...form, currencyDisplayName: v })}
                placeholder={t("constitution.ch1.displayPh")}
              />
            </div>
          </Section>

          <Section
            eyebrow={t("constitution.ch2.eyebrow")}
            title={t("constitution.ch2.title")}
            description={t("constitution.ch2.desc")}
          >
            <Grid3>
              <NumberField
                label={t("constitution.ch2.citizenship")}
                hint={t("constitution.ch2.citizenshipHint")}
                value={form.citizenshipFeeAmount}
                onChange={(v) =>
                  setForm({ ...form, citizenshipFeeAmount: v })
                }
                min={0}
                step={1}
              />
              <NumberField
                label={t("constitution.ch2.exitRefund")}
                hint={t("constitution.ch2.exitRefundHint")}
                value={form.exitRefundPct}
                onChange={(v) => setForm({ ...form, exitRefundPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <ToggleField
                label={t("constitution.ch2.rolesPurchasable")}
                hint={t("constitution.ch2.rolesPurchasableHint")}
                checked={form.rolesPurchasable}
                onChange={(v) =>
                  setForm({ ...form, rolesPurchasable: v })
                }
              />
            </Grid3>
          </Section>

          <Section
            eyebrow={t("constitution.ch3.eyebrow")}
            title={t("constitution.ch3.title")}
            description={t("constitution.ch3.desc")}
          >
            <Grid3>
              <ToggleField
                label={t("constitution.ch3.inheritance")}
                hint={t("constitution.ch3.inheritanceHint")}
                checked={form.permissionInheritance}
                onChange={(v) =>
                  setForm({ ...form, permissionInheritance: v })
                }
              />
              <ToggleField
                label={t("constitution.ch3.autoPromo")}
                hint={t("constitution.ch3.autoPromoHint")}
                checked={form.autoPromotionEnabled}
                onChange={(v) =>
                  setForm({ ...form, autoPromotionEnabled: v })
                }
              />
              <SelectField
                label={t("constitution.ch3.treasury")}
                hint={t("constitution.ch3.treasuryHint")}
                value={form.treasuryTransparency}
                onChange={(v) =>
                  setForm({
                    ...form,
                    treasuryTransparency: v as TreasuryTransparency,
                  })
                }
                options={[
                  {
                    value: "public",
                    label: t("constitution.ch3.treasury.public"),
                  },
                  {
                    value: "council",
                    label: t("constitution.ch3.treasury.council"),
                  },
                  {
                    value: "sovereign",
                    label: t("constitution.ch3.treasury.sovereign"),
                  },
                ]}
              />
            </Grid3>

            {form.autoPromotionEnabled && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <NumberField
                  label={t("constitution.ch3.promoBalance")}
                  hint={t("constitution.ch3.promoBalanceHint")}
                  value={form.autoPromotionMinBalance}
                  onChange={(v) =>
                    setForm({ ...form, autoPromotionMinBalance: v })
                  }
                  min={0}
                  step={1}
                />
                <NumberField
                  label={t("constitution.ch3.promoDays")}
                  hint={t("constitution.ch3.promoDaysHint")}
                  value={form.autoPromotionMinDays}
                  onChange={(v) =>
                    setForm({ ...form, autoPromotionMinDays: v })
                  }
                  min={0}
                  step={1}
                />
                <TextField
                  label={t("constitution.ch3.promoTarget")}
                  hint={t("constitution.ch3.promoTargetHint")}
                  value={form.autoPromotionTargetNodeId}
                  onChange={(v) =>
                    setForm({ ...form, autoPromotionTargetNodeId: v })
                  }
                  placeholder="c…"
                />
              </div>
            )}
          </Section>

          <Section
            eyebrow={t("constitution.ch4.eyebrow")}
            title={t("constitution.ch4.title")}
            description={t("constitution.ch4.desc")}
          >
            <Grid3>
              <SelectField
                label={t("constitution.ch4.mode")}
                hint={t("constitution.ch4.modeHint")}
                value={form.governanceMode}
                onChange={(v) =>
                  setForm({ ...form, governanceMode: v as GovernanceMode })
                }
                options={[
                  {
                    value: "decree",
                    label: t("constitution.ch4.mode.decree"),
                  },
                  {
                    value: "consultation",
                    label: t("constitution.ch4.mode.consultation"),
                  },
                  {
                    value: "auto_dao",
                    label: t("constitution.ch4.mode.auto"),
                  },
                ]}
              />
              <ToggleField
                label={t("constitution.ch4.veto")}
                hint={t("constitution.ch4.vetoHint")}
                checked={form.governanceSovereignVeto}
                onChange={(v) =>
                  setForm({ ...form, governanceSovereignVeto: v })
                }
              />
              <SelectField
                label={t("constitution.ch4.weight")}
                hint={t("constitution.ch4.weightHint")}
                value={form.governanceWeightStrategy}
                onChange={(v) =>
                  setForm({
                    ...form,
                    governanceWeightStrategy: v as WeightStrategy,
                  })
                }
                options={[
                  {
                    value: "one_person_one_vote",
                    label: t("constitution.ch4.weight.person"),
                  },
                  {
                    value: "by_node_weight",
                    label: t("constitution.ch4.weight.node"),
                  },
                  {
                    value: "by_balance",
                    label: t("constitution.ch4.weight.balance"),
                  },
                ]}
              />
            </Grid3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <NumberField
                label={t("constitution.ch4.quorum")}
                hint={t("constitution.ch4.quorumHint")}
                value={form.governanceQuorumPct}
                onChange={(v) =>
                  setForm({ ...form, governanceQuorumPct: v })
                }
                min={0}
                max={100}
                step={0.5}
              />
              <NumberField
                label={t("constitution.ch4.threshold")}
                hint={t("constitution.ch4.thresholdHint")}
                value={form.governanceThresholdPct}
                onChange={(v) =>
                  setForm({ ...form, governanceThresholdPct: v })
                }
                min={0}
                max={100}
                step={0.5}
              />
              <NumberField
                label={t("constitution.ch4.duration")}
                hint={t("constitution.ch4.durationHint")}
                value={form.governanceDurationDays}
                onChange={(v) =>
                  setForm({ ...form, governanceDurationDays: v })
                }
                min={0.001}
                max={365}
                step={0.5}
              />
            </div>
            <div className="mt-4">
              <NumberField
                label={t("constitution.ch4.minBalance")}
                hint={t("constitution.ch4.minBalanceHint")}
                value={form.governanceMinProposerBalance}
                onChange={(v) =>
                  setForm({ ...form, governanceMinProposerBalance: v })
                }
                min={0}
                step={1}
              />
            </div>

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
                {t("constitution.ch4.allowedTitle")}
              </p>
              <p className="mt-1 text-xs text-foreground/50">
                {t("constitution.ch4.allowedDesc", {
                  link: t("constitution.ch4.allowedLink"),
                })}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {GOVERNANCE_MANAGEABLE_KEYS.map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background/30 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-crown"
                      checked={!!form.governanceAllowedKeys[key]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          governanceAllowedKeys: {
                            ...form.governanceAllowedKeys,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    <span className="flex-1 text-foreground/80">
                      {t(`constitution.keys.${key}`)}
                    </span>
                    <code className="text-[10px] text-foreground/40">
                      {key}
                    </code>
                  </label>
                ))}
              </div>
            </div>
          </Section>

          <div className="flex items-center justify-end gap-3 border-t border-border/60 pt-6">
            <p className="text-xs text-foreground/50">
              {dirty
                ? t("constitution.dirty")
                : t("constitution.clean")}
            </p>
            <Button
              type="submit"
              variant="crown"
              disabled={!dirty || saving}
              title={dirty ? undefined : t("constitution.signHint")}
            >
              {saving
                ? t("constitution.signing")
                : t("constitution.sign")}
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}

function buildPatch(form: FormState): Record<string, unknown> {
  const toFraction = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n)) / 100;
  };
  const toNonNegNumber = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  };
  const nullableNumber = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };
  const nullableInt = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  };
  const nullableText = (raw: string): string | null => {
    const t = raw.trim();
    return t.length === 0 ? null : t;
  };

  const toBps = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10_000, Math.round(n * 100)));
  };
  const toDurationSeconds = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 3 * 86_400;
    const seconds = Math.round(n * 86_400);
    return Math.max(60, Math.min(60 * 60 * 24 * 365, seconds));
  };

  const allowedConfigKeys: string[] = [];
  for (const key of GOVERNANCE_MANAGEABLE_KEYS) {
    if (form.governanceAllowedKeys[key]) allowedConfigKeys.push(key);
  }

  return {
    uiLocale: form.uiLocale.trim().toLowerCase() || null,
    transactionTaxRate: toFraction(form.transactionTaxPct),
    incomeTaxRate: toFraction(form.incomeTaxPct),
    roleTaxRate: toFraction(form.roleTaxPct),
    payrollEnabled: form.payrollEnabled,
    payrollAmountPerCitizen: toNonNegNumber(form.payrollAmountPerCitizen),
    currencyDisplayName: nullableText(form.currencyDisplayName),

    citizenshipFeeAmount: toNonNegNumber(form.citizenshipFeeAmount),
    rolesPurchasable: form.rolesPurchasable,
    exitRefundRate: toFraction(form.exitRefundPct),

    permissionInheritance: form.permissionInheritance,
    autoPromotionEnabled: form.autoPromotionEnabled,
    autoPromotionMinBalance: nullableNumber(form.autoPromotionMinBalance),
    autoPromotionMinDays: nullableInt(form.autoPromotionMinDays),
    autoPromotionTargetNodeId: nullableText(form.autoPromotionTargetNodeId),
    treasuryTransparency: form.treasuryTransparency,

    governanceRules: {
      mode: form.governanceMode,
      sovereignVeto: form.governanceSovereignVeto,
      quorumBps: toBps(form.governanceQuorumPct),
      thresholdBps: toBps(form.governanceThresholdPct),
      votingDurationSeconds: toDurationSeconds(form.governanceDurationDays),
      weightStrategy: form.governanceWeightStrategy,
      minProposerBalance: nullableNumber(form.governanceMinProposerBalance),
      allowedConfigKeys,
    },
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      {children}
    </main>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("constitution.token.title")}</CardTitle>
      <CardDescription>
        {t("constitution.token.desc", {
          perm: "state.configure",
          cmd: "krwn token mint",
        })}
      </CardDescription>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <Input
          placeholder="kt_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <Button type="submit" variant="crown">
          {t("common.login")}
        </Button>
      </form>
    </Card>
  );
}

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id}>
      <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
        {eyebrow}
      </p>
      <CardTitle className="mt-1">{title}</CardTitle>
      {description && (
        <CardDescription className="mt-2">{description}</CardDescription>
      )}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-3">{children}</div>;
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
      </label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        className="mt-2"
      />
      {hint && <p className="mt-1 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2"
      />
      {hint && <p className="mt-1 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
            checked
              ? "border-crown/60 bg-crown/40"
              : "border-border bg-background",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform",
              checked ? "translate-x-5" : "translate-x-1",
            )}
          />
        </button>
      </label>
      {hint && <p className="mt-1 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
      </label>
      <select
        className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}
