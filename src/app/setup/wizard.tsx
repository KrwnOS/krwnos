"use client";

/**
 * First Launch Wizard («Коронация»).
 * ------------------------------------------------------------
 * A single-screen, four-step magical ceremony that spins up a
 * brand-new KrwnOS instance the very first time the Docker
 * container is booted by its owner.
 *
 *   1. State     — название государства (+ slug / краткое описание).
 *   2. Currency  — первая запись в Фабрике Валют (StateAsset):
 *                  тикер, парадное имя, глиф, цвет, decimals.
 *   3. Sovereign — Суверен: @handle, display name, email.
 *   4. Done      — секретные материалы, которые показываются
 *                  РОВНО ОДИН РАЗ: bootstrap CLI-токен и первый
 *                  magic-link инвайт («первый министр»).
 *
 * The wizard POSTs to `/api/setup` once — the server runs the
 * whole bootstrap atomically in a single transaction, so
 * navigating back/forward between UI steps never leaves the DB
 * in a half-initialised state.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// Должно совпадать с ключом в `src/modules/chat/components/useChat.ts`.
// Сохраняем bootstrap-токен сюда сразу после коронации, чтобы чат
// и другие клиентские модули подхватили его без ручного ввода.
const TOKEN_STORAGE_KEY = "krwn.token";

function persistBootstrapToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage может быть заблокирован (приватный режим) —
    // тогда пользователь увидит форму ввода в чате и вставит токен вручную.
  }
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

interface StateDraft {
  stateName: string;
  stateSlug: string;
  stateDescription: string;
}

interface CurrencyDraft {
  symbol: string;
  name: string;
  icon: string;
  color: string;
  decimals: string; // kept as string for controlled <input type="number">
}

interface SovereignDraft {
  ownerHandle: string;
  ownerDisplayName: string;
  ownerEmail: string;
}

interface SetupInvite {
  invitationId: string;
  token: string;
  url: string;
  code: string;
  expiresAt: string | null;
  maxUses: number;
  label: string | null;
}

interface SetupSuccess {
  stateId: string;
  stateSlug: string;
  sovereignNodeId: string;
  userId: string;
  cliToken: string;
  cliTokenId: string;
  primaryAssetId: string;
  primaryAssetSymbol: string;
  invite: SetupInvite | null;
}

/** Mirrors `Button` crown + lg for a single accessible `Link` CTA. */
const ButtonClassCrownLg = cn(
  "inline-flex min-h-12 items-center justify-center rounded-md px-6 text-base font-medium transition-colors motion-reduce:transition-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "bg-crown text-black hover:bg-crown/90 shadow-[0_0_24px_-6px_rgba(212,175,55,0.6)]",
);

const CURRENCY_PRESETS = [
  { symbol: "KRN", name: "Krona", icon: "⚜", color: "#C9A227" },
  { symbol: "GOLD", name: "Gold", icon: "🪙", color: "#E0B200" },
  { symbol: "CRED", name: "Credit", icon: "◈", color: "#5BC0EB" },
  { symbol: "COIN", name: "Coin", icon: "●", color: "#9B59B6" },
] as const;

// ------------------------------------------------------------
// Root component
// ------------------------------------------------------------

export function SetupWizard() {
  const t = useT();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupSuccess | null>(null);

  const [stateDraft, setStateDraft] = useState<StateDraft>({
    stateName: "",
    stateSlug: "",
    stateDescription: "",
  });

  const [currencyDraft, setCurrencyDraft] = useState<CurrencyDraft>({
    symbol: "KRN",
    name: "Krona",
    icon: "⚜",
    color: "#C9A227",
    decimals: "18",
  });

  const [sovereignDraft, setSovereignDraft] = useState<SovereignDraft>({
    ownerHandle: "",
    ownerDisplayName: "",
    ownerEmail: "",
  });

  const [rotated, setRotated] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const canNextFromState =
    stateDraft.stateName.trim().length >= 2 &&
    stateDraft.stateName.length <= 80 &&
    (stateDraft.stateSlug === "" ||
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stateDraft.stateSlug));

  const canNextFromCurrency =
    /^[A-Z0-9]{2,12}$/.test(currencyDraft.symbol.trim().toUpperCase()) &&
    currencyDraft.name.trim().length >= 2 &&
    currencyDraft.icon.trim().length > 0 &&
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(currencyDraft.color.trim());

  const canSubmit =
    /^[a-z0-9_]{3,32}$/.test(sovereignDraft.ownerHandle.trim().toLowerCase()) &&
    (sovereignDraft.ownerEmail === "" ||
      /^\S+@\S+\.\S+$/.test(sovereignDraft.ownerEmail));

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        stateName: stateDraft.stateName.trim(),
        stateSlug: stateDraft.stateSlug.trim() || undefined,
        stateDescription: stateDraft.stateDescription.trim() || undefined,
        ownerHandle: sovereignDraft.ownerHandle.trim().toLowerCase(),
        ownerDisplayName:
          sovereignDraft.ownerDisplayName.trim() || undefined,
        ownerEmail: sovereignDraft.ownerEmail.trim() || undefined,
        currency: {
          symbol: currencyDraft.symbol.trim().toUpperCase(),
          name: currencyDraft.name.trim(),
          icon: currencyDraft.icon.trim(),
          color: currencyDraft.color.trim(),
          decimals: Number(currencyDraft.decimals) || 18,
        },
        invite: { enabled: true, ttlDays: 30, maxUses: 1 },
      };

      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Setup failed");
      }
      const success = data as SetupSuccess;
      persistBootstrapToken(success.cliToken);
      setResult(success);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function rotateBootstrap() {
    if (!result) return;
    setRotating(true);
    setError(null);
    try {
      const res = await fetch("/api/cli/tokens/rotate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${result.cliToken}`,
        },
        body: JSON.stringify({ label: "sovereign rotated (first-login)" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Rotation failed");
      }
      const newToken = data.token as string;
      persistBootstrapToken(newToken);
      setRotated(newToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  }

  // ----------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------

  if (step === 4 && result) {
    return (
      <DoneScreen
        result={result}
        rotated={rotated}
        rotating={rotating}
        onRotate={rotateBootstrap}
        error={error}
      />
    );
  }

  return (
    <Card className="w-full">
      <Stepper current={step} />

      {step === 1 && (
        <StepIdentity
          draft={stateDraft}
          onChange={setStateDraft}
          title={t("setup.step1.title")}
          description={t("setup.step1.desc")}
        />
      )}

      {step === 2 && (
        <StepCurrency
          draft={currencyDraft}
          onChange={setCurrencyDraft}
          title={t("setup.step2.title")}
          description={t("setup.step2.desc")}
        />
      )}

      {step === 3 && (
        <StepSovereign
          draft={sovereignDraft}
          onChange={setSovereignDraft}
          title={t("setup.step3.title")}
          description={t("setup.step3.desc")}
        />
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          disabled={step === 1 || submitting}
        >
          {t("setup.nav.back")}
        </Button>

        {step < 3 ? (
          <Button
            type="button"
            variant="crown"
            onClick={() => setStep((s) => ((s + 1) as 2 | 3))}
            disabled={
              (step === 1 && !canNextFromState) ||
              (step === 2 && !canNextFromCurrency)
            }
          >
            {t("setup.nav.next")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="crown"
            size="lg"
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting
              ? t("setup.form.submitting")
              : t("setup.form.submit")}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Stepper (progress indicator)
// ------------------------------------------------------------

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const t = useT();
  const steps = [
    { n: 1, label: t("setup.step1.nav") },
    { n: 2, label: t("setup.step2.nav") },
    { n: 3, label: t("setup.step3.nav") },
  ] as const;

  return (
    <nav
      className="mb-8 flex items-center gap-3"
      aria-label={t("setup.stepper.a11yNav")}
    >
      {steps.map((s, i) => {
        const done = current > s.n || current === 4;
        const active = current === s.n;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-3">
            <div
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors motion-reduce:transition-none",
                done && "border-crown bg-crown text-black",
                active && "border-crown text-crown",
                !done && !active && "border-border text-foreground/50",
              )}
            >
              {done ? "✓" : s.n}
            </div>
            <div className="min-w-0">
              <div
                className={cn(
                  "truncate text-xs uppercase tracking-widest",
                  active ? "text-crown" : "text-foreground/50",
                )}
              >
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "ml-auto hidden h-px flex-1 sm:block",
                  current > s.n ? "bg-crown/50" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ------------------------------------------------------------
// Step 1 — State identity
// ------------------------------------------------------------

function StepIdentity({
  draft,
  onChange,
  title,
  description,
}: {
  draft: StateDraft;
  onChange: (d: StateDraft) => void;
  title: string;
  description: string;
}) {
  const t = useT();
  return (
    <div>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>

      <div className="mt-6 flex flex-col gap-5">
        <Field
          label={t("setup.form.stateName")}
          name="stateName"
          placeholder="Корпорация X, Клан Тени, Crown Republic…"
          required
          value={draft.stateName}
          onChange={(v) => onChange({ ...draft, stateName: v })}
          maxLength={80}
          autoFocus
        />
        <Field
          label={t("setup.form.stateSlug")}
          name="stateSlug"
          placeholder="crown-republic"
          hint={t("setup.form.stateSlugHint")}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          value={draft.stateSlug}
          onChange={(v) =>
            onChange({
              ...draft,
              stateSlug: v
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-+|-+$/g, ""),
            })
          }
        />
        <Field
          label={t("setup.form.stateDesc")}
          name="stateDescription"
          placeholder={t("setup.form.stateDescPh")}
          maxLength={500}
          value={draft.stateDescription}
          onChange={(v) => onChange({ ...draft, stateDescription: v })}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Step 2 — Currency Factory seed
// ------------------------------------------------------------

function StepCurrency({
  draft,
  onChange,
  title,
  description,
}: {
  draft: CurrencyDraft;
  onChange: (d: CurrencyDraft) => void;
  title: string;
  description: string;
}) {
  const t = useT();
  return (
    <div>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>

      <div className="mt-6">
        <div className="mb-2 text-xs uppercase tracking-widest text-foreground/60">
          {t("setup.step2.presets")}
        </div>
        <div className="flex flex-wrap gap-2">
          {CURRENCY_PRESETS.map((p) => {
            const active = draft.symbol === p.symbol;
            return (
              <button
                key={p.symbol}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({ ...draft, ...p, decimals: draft.decimals })
                }
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none",
                  active
                    ? "border-crown bg-crown/10 text-foreground"
                    : "border-border text-foreground/70 hover:border-crown/60 hover:text-foreground",
                )}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-xs"
                  style={{ backgroundColor: p.color, color: "#000" }}
                >
                  {p.icon}
                </span>
                <span className="font-mono">{p.symbol}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-5">
        <Field
          label={t("setup.step2.symbol")}
          name="currencySymbol"
          placeholder="KRN"
          required
          maxLength={12}
          pattern="[A-Za-z0-9]{2,12}"
          value={draft.symbol}
          onChange={(v) =>
            onChange({
              ...draft,
              symbol: v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
            })
          }
          hint={t("setup.step2.symbolHint")}
          mono
        />
        <Field
          label={t("setup.step2.name")}
          name="currencyName"
          placeholder="Krona"
          required
          maxLength={60}
          value={draft.name}
          onChange={(v) => onChange({ ...draft, name: v })}
        />
        <Field
          label={t("setup.step2.icon")}
          name="currencyIcon"
          placeholder="⚜"
          maxLength={8}
          value={draft.icon}
          onChange={(v) => onChange({ ...draft, icon: v })}
          hint={t("setup.step2.iconHint")}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-widest text-foreground/60">
            {t("setup.step2.color")}
          </span>
          <div className="flex h-11 items-center gap-3 rounded-md border border-border bg-background/50 px-3">
            <input
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : "#C9A227"
              }
              onChange={(e) => onChange({ ...draft, color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded-sm border-0 bg-transparent p-0"
              aria-label={t("setup.step2.color")}
            />
            <input
              id="setup-field-currencyColorHex"
              value={draft.color}
              onChange={(e) => onChange({ ...draft, color: e.target.value })}
              placeholder="#C9A227"
              aria-label={t("setup.step2.color")}
              className="flex-1 bg-transparent font-mono text-sm focus:outline-none"
            />
          </div>
        </div>
        <Field
          label={t("setup.step2.decimals")}
          name="currencyDecimals"
          type="number"
          min={0}
          max={36}
          value={draft.decimals}
          onChange={(v) => onChange({ ...draft, decimals: v })}
          hint={t("setup.step2.decimalsHint")}
          mono
        />
      </div>

      <div className="mt-6 rounded-md border border-border/60 bg-foreground/5 p-4">
        <div className="mb-2 text-xs uppercase tracking-widest text-foreground/50">
          {t("setup.step2.preview")}
        </div>
        <CurrencyPreview draft={draft} />
      </div>
    </div>
  );
}

function CurrencyPreview({ draft }: { draft: CurrencyDraft }) {
  const symbol = draft.symbol.trim().toUpperCase() || "KRN";
  const color = /^#[0-9a-fA-F]{3,6}$/.test(draft.color) ? draft.color : "#C9A227";
  return (
    <div className="flex items-center gap-4">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold text-black shadow-[0_0_30px_-10px_rgba(212,175,55,0.8)]"
        style={{ backgroundColor: color }}
      >
        {draft.icon || "⚜"}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-foreground">
          {draft.name || "—"}
        </div>
        <div className="font-mono text-xs text-foreground/60">
          {symbol} · {draft.decimals || 0} decimals · INTERNAL / LOCAL
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Step 3 — Sovereign identity
// ------------------------------------------------------------

function StepSovereign({
  draft,
  onChange,
  title,
  description,
}: {
  draft: SovereignDraft;
  onChange: (d: SovereignDraft) => void;
  title: string;
  description: string;
}) {
  const t = useT();
  return (
    <div>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>

      <div className="mt-6 flex flex-col gap-5">
        <Field
          label={t("setup.form.ownerHandle")}
          name="ownerHandle"
          placeholder="sovereign"
          required
          maxLength={32}
          pattern="[a-z0-9_]{3,32}"
          value={draft.ownerHandle}
          onChange={(v) =>
            onChange({
              ...draft,
              ownerHandle: v
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "")
                .slice(0, 32),
            })
          }
          mono
          autoFocus
        />
        <Field
          label={t("setup.form.ownerDisplayName")}
          name="ownerDisplayName"
          placeholder={t("setup.form.ownerDisplayNamePh")}
          maxLength={80}
          value={draft.ownerDisplayName}
          onChange={(v) => onChange({ ...draft, ownerDisplayName: v })}
        />
        <Field
          label={t("setup.form.ownerEmail")}
          name="ownerEmail"
          type="email"
          placeholder="red@example.com"
          hint={t("setup.form.ownerEmailHint")}
          value={draft.ownerEmail}
          onChange={(v) => onChange({ ...draft, ownerEmail: v })}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Step 4 — Done (secrets revealed once)
// ------------------------------------------------------------

function DoneScreen({
  result,
  rotated,
  rotating,
  onRotate,
  error,
}: {
  result: SetupSuccess;
  rotated: string | null;
  rotating: boolean;
  onRotate: () => void;
  error: string | null;
}) {
  const t = useT();
  const activeToken = rotated ?? result.cliToken;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <Card className="w-full">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-crown text-black">
          ✓
        </div>
        <div>
          <CardTitle>{t("setup.done.title")}</CardTitle>
          <CardDescription>
            <span className="font-mono text-foreground/80">
              /s/{result.stateSlug}
            </span>{" "}
            {t("setup.done.subtitle")}
          </CardDescription>
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <Row label="stateId" value={result.stateId} />
        <Row label="sovereignNodeId" value={result.sovereignNodeId} />
        <Row label="userId" value={result.userId} />
        <Row
          label="primaryAsset"
          value={`${result.primaryAssetSymbol} · ${result.primaryAssetId}`}
        />
      </div>

      {/* --- Bootstrap CLI token --- */}
      <SecretBlock
        title={
          rotated
            ? t("setup.done.rotatedToken")
            : t("setup.done.bootstrapToken")
        }
        value={activeToken}
        hint={
          <code className="rounded bg-foreground/5 px-1 py-0.5">
            krwn login --host {origin} --token {activeToken.slice(0, 12)}…
          </code>
        }
      />

      {!rotated ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-foreground/60">
            {t("setup.done.replaceHint")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onRotate}
            disabled={rotating}
          >
            {rotating ? t("setup.done.rotating") : t("setup.done.rotate")}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-xs text-green-500">
          {t("setup.done.rotated")}
        </p>
      )}

      {/* --- First invite --- */}
      {result.invite && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-crown">
            <span>{t("setup.done.inviteTitle")}</span>
            <span className="text-foreground/40">
              {t("setup.done.shownOnce")}
            </span>
          </div>
          <div className="rounded-md border border-crown/40 bg-crown/5 p-4">
            <p className="mb-3 text-xs text-foreground/60">
              {t("setup.done.inviteDesc")}
            </p>
            <CopyableLine value={result.invite.url} />
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div className="flex flex-col">
                <span className="uppercase tracking-widest text-foreground/50">
                  {t("setup.done.inviteCode")}
                </span>
                <code className="mt-1 font-mono text-crown">
                  {result.invite.code}
                </code>
              </div>
              <div className="flex flex-col">
                <span className="uppercase tracking-widest text-foreground/50">
                  {t("setup.done.inviteExpires")}
                </span>
                <span className="mt-1 font-mono text-foreground/70">
                  {result.invite.expiresAt
                    ? new Date(result.invite.expiresAt).toLocaleString()
                    : t("setup.done.inviteNever")}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-8 flex flex-col gap-2">
        <Link
          href="/dashboard"
          className={cn(
            ButtonClassCrownLg,
            "w-full text-center",
          )}
        >
          {t("setup.done.enter")}
        </Link>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Primitive UI atoms
// ------------------------------------------------------------

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  mono?: boolean;
}) {
  const fieldId = `setup-field-${props.name}`;
  return (
    <label className="flex flex-col gap-1.5" htmlFor={fieldId}>
      <span className="text-xs uppercase tracking-widest text-foreground/60">
        {props.label}
        {props.required ? <span className="text-crown"> *</span> : null}
      </span>
      <input
        id={fieldId}
        name={props.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        required={props.required}
        maxLength={props.maxLength}
        min={props.min}
        max={props.max}
        pattern={props.pattern}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoFocus={props.autoFocus}
        className={cn(
          "h-11 rounded-md border border-border bg-background/50 px-3 text-sm",
          "focus:border-crown focus:outline-none focus:ring-2 focus:ring-crown/30",
          props.mono && "font-mono",
        )}
      />
      {props.hint ? (
        <span className="text-xs text-foreground/50">{props.hint}</span>
      ) : null}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-foreground/5 px-3 py-2">
      <span className="text-xs uppercase tracking-widest text-foreground/50">
        {label}
      </span>
      <code className="break-all font-mono text-xs text-foreground/80">
        {value}
      </code>
    </div>
  );
}

function SecretBlock({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="mt-8 rounded-md border border-crown/40 bg-crown/5 p-4">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-crown">
        <span>{title}</span>
        <span className="text-foreground/40">{t("setup.done.shownOnce")}</span>
      </div>
      <CopyableLine value={value} />
      {hint ? (
        <div className="mt-3 text-xs text-foreground/60">{hint}</div>
      ) : null}
    </div>
  );
}

function CopyableLine({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  // Memo guard — avoid accidental re-timeouts on rapid rerenders.
  const onCopy = useMemo(
    () => async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        setCopied(false);
      }
    },
    [value],
  );

  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 break-all font-mono text-sm text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          "shrink-0 rounded-md border border-border px-2 py-1 text-xs uppercase tracking-widest transition-colors",
          copied
            ? "border-green-500/60 text-green-400"
            : "text-foreground/60 hover:border-crown/60 hover:text-foreground",
        )}
      >
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
