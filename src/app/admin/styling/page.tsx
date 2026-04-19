/**
 * `/admin/styling` — Визуальный конструктор (Styling Hub).
 * ------------------------------------------------------------
 * Витрина, где Суверен «натягивает» облик своего государства.
 *
 * Содержимое:
 *   1. Галерея пресетов — Minimalist High-Tech, Terminal, Glass,
 *      Royal Gold, Cyberpunk. Клик → мгновенная смена темы.
 *   2. Live-панель токенов: цвета (<input type="color">), шрифты
 *      (<select>), ползунок скругления углов, свечения, размытия.
 *      Любое изменение едет в `useTheme().mergeTokens()` → CSS
 *      переменные `:root` перекрашиваются в тот же кадр.
 *   3. Предпросмотр — компактная реплика компонентов ОС (кнопки,
 *      карточки, инпуты, badges) под живой темой.
 *   4. Custom CSS — <textarea> для продвинутых Суверенов.
 *   5. «Сохранить указ» — PATCH `/api/state/theme` с текущим
 *      состоянием. «Отменить» — откат к версии, загруженной в
 *      начале сессии.
 *
 * Все тексты — через i18n (`styling.*`).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/core/theme-provider";
import {
  DEFAULT_THEME_CONFIG,
  THEME_PRESETS,
  THEME_PRESET_ORDER,
  normaliseThemeConfig,
  type ThemeConfig,
  type ThemePresetId,
} from "@/core/theme";

const TOKEN_STORAGE_KEY = "krwn.token";

type PresetId = Exclude<ThemePresetId, "custom">;

export default function AdminStylingPage() {
  const { t } = useI18n();
  const { theme, setTheme, applyPreset, mergeTokens, resetTheme } = useTheme();

  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState<ThemeConfig | null>(null);
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
      const res = await fetch("/api/state/theme", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as
        | { theme: unknown }
        | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : `HTTP ${res.status}`,
        );
      }
      if ("theme" in payload) {
        const next = normaliseThemeConfig(payload.theme);
        setSaved(next);
        setTheme(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }, [token, setTheme]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty = useMemo(() => {
    if (!saved) return false;
    return JSON.stringify(saved) !== JSON.stringify(theme);
  }, [saved, theme]);

  const onSave = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/state/theme", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(theme),
      });
      const payload = (await res.json()) as
        | { theme: unknown }
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
      if ("theme" in payload) {
        const next = normaliseThemeConfig(payload.theme);
        setSaved(next);
        setTheme(next);
        setFlash(t("styling.saved"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const onRevert = () => {
    if (!saved) return;
    setTheme(saved);
    setFlash(null);
    setError(null);
  };

  const onResetToDefault = () => {
    resetTheme();
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
            {t("styling.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {t("styling.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            {t("styling.subtitle")}
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
              setSaved(null);
            }}
          >
            {t("common.logout")}
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", { message: error })}
          <br />
          <span className="text-xs opacity-70">
            {t("styling.errorHint", { perm: "state.configure" })}
          </span>
        </Card>
      )}

      {flash && (
        <Card className="mb-6 border-crown/40 bg-crown/5 text-sm text-crown">
          {flash}
        </Card>
      )}

      <PresetGallery
        activePresetId={theme.preset}
        onPick={(id) => {
          applyPreset(id);
        }}
      />

      <Section
        eyebrow={t("styling.palette.eyebrow")}
        title={t("styling.palette.title")}
        description={t("styling.palette.desc")}
      >
        <Grid3>
          <ColorField
            label={t("styling.palette.background")}
            value={theme.colors.background}
            onChange={(v) =>
              mergeTokens({ colors: { background: v } })
            }
          />
          <ColorField
            label={t("styling.palette.foreground")}
            value={theme.colors.foreground}
            onChange={(v) =>
              mergeTokens({ colors: { foreground: v } })
            }
          />
          <ColorField
            label={t("styling.palette.card")}
            value={theme.colors.card}
            onChange={(v) => mergeTokens({ colors: { card: v } })}
          />
          <ColorField
            label={t("styling.palette.muted")}
            value={theme.colors.muted}
            onChange={(v) => mergeTokens({ colors: { muted: v } })}
          />
          <ColorField
            label={t("styling.palette.border")}
            value={theme.colors.border}
            onChange={(v) => mergeTokens({ colors: { border: v } })}
          />
          <ColorField
            label={t("styling.palette.accent")}
            value={theme.colors.accent}
            onChange={(v) => mergeTokens({ colors: { accent: v } })}
          />
          <ColorField
            label={t("styling.palette.primary")}
            value={theme.colors.primary}
            onChange={(v) => mergeTokens({ colors: { primary: v } })}
          />
          <ColorField
            label={t("styling.palette.destructive")}
            value={theme.colors.destructive}
            onChange={(v) =>
              mergeTokens({ colors: { destructive: v } })
            }
          />
        </Grid3>
      </Section>

      <Section
        eyebrow={t("styling.typography.eyebrow")}
        title={t("styling.typography.title")}
        description={t("styling.typography.desc")}
      >
        <Grid3>
          <SelectField
            label={t("styling.typography.sans")}
            value={pickStackId(theme.fonts.sans, SANS_STACKS)}
            onChange={(id) =>
              mergeTokens({
                fonts: { sans: SANS_STACKS[id] ?? theme.fonts.sans },
              })
            }
            options={Object.entries(SANS_STACKS).map(([id, stack]) => ({
              value: id,
              label: stack.split(",")[0]?.replace(/['"]/g, "") ?? id,
            }))}
          />
          <SelectField
            label={t("styling.typography.mono")}
            value={pickStackId(theme.fonts.mono, MONO_STACKS)}
            onChange={(id) =>
              mergeTokens({
                fonts: { mono: MONO_STACKS[id] ?? theme.fonts.mono },
              })
            }
            options={Object.entries(MONO_STACKS).map(([id, stack]) => ({
              value: id,
              label: stack.split(",")[0]?.replace(/['"]/g, "") ?? id,
            }))}
          />
          <TextField
            label={t("styling.typography.display")}
            value={theme.fonts.display ?? ""}
            onChange={(v) =>
              mergeTokens({
                fonts: { display: v.trim().length === 0 ? null : v },
              })
            }
            placeholder="Cinzel, serif"
            hint={t("styling.typography.displayHint")}
          />
        </Grid3>
      </Section>

      <Section
        eyebrow={t("styling.shape.eyebrow")}
        title={t("styling.shape.title")}
        description={t("styling.shape.desc")}
      >
        <Grid3>
          <SliderField
            label={t("styling.shape.radiusSm")}
            value={remToPx(theme.radius.sm)}
            onChange={(px) =>
              mergeTokens({ radius: { sm: pxToRem(px) } })
            }
            min={0}
            max={32}
            step={1}
            unit="px"
          />
          <SliderField
            label={t("styling.shape.radiusMd")}
            value={remToPx(theme.radius.md)}
            onChange={(px) =>
              mergeTokens({ radius: { md: pxToRem(px) } })
            }
            min={0}
            max={32}
            step={1}
            unit="px"
          />
          <SliderField
            label={t("styling.shape.radiusLg")}
            value={remToPx(theme.radius.lg)}
            onChange={(px) =>
              mergeTokens({ radius: { lg: pxToRem(px) } })
            }
            min={0}
            max={48}
            step={1}
            unit="px"
          />
          <SliderField
            label={t("styling.shape.blur")}
            value={parseFloat(theme.effects?.blur ?? "0") || 0}
            onChange={(v) =>
              mergeTokens({ effects: { blur: `${v}px` } })
            }
            min={0}
            max={40}
            step={1}
            unit="px"
          />
        </Grid3>
      </Section>

      <Section
        eyebrow={t("styling.preview.eyebrow")}
        title={t("styling.preview.title")}
        description={t("styling.preview.desc")}
      >
        <LivePreview />
      </Section>

      <Section
        eyebrow={t("styling.custom.eyebrow")}
        title={t("styling.custom.title")}
        description={t("styling.custom.desc")}
      >
        <textarea
          className={cn(
            "min-h-[180px] w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground",
            "placeholder:text-foreground/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crown focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          placeholder={"/* Ваш CSS. Например:\n  body { background: radial-gradient(...); }\n*/"}
          value={theme.customCss ?? ""}
          onChange={(e) =>
            mergeTokens({ customCss: e.target.value })
          }
          spellCheck={false}
        />
        <p className="mt-2 text-xs text-foreground/50">
          {t("styling.custom.hint")}
        </p>
      </Section>

      <div className="sticky bottom-4 mt-8 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetToDefault}
            title={t("styling.resetHint")}
          >
            {t("styling.reset")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRevert}
            disabled={!dirty}
          >
            {t("styling.revert")}
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-foreground/50">
            {dirty ? t("styling.dirty") : t("styling.clean")}
          </p>
          <Button
            variant="crown"
            onClick={() => void onSave()}
            disabled={!dirty || saving}
          >
            {saving ? t("styling.saving") : t("styling.save")}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

// ============================================================
// Preset gallery
// ============================================================

function PresetGallery({
  activePresetId,
  onPick,
}: {
  activePresetId: ThemePresetId;
  onPick: (id: PresetId) => void;
}) {
  const { t } = useI18n();
  return (
    <Section
      eyebrow={t("styling.presets.eyebrow")}
      title={t("styling.presets.title")}
      description={t("styling.presets.desc")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {THEME_PRESET_ORDER.map((id) => (
          <PresetCard
            key={id}
            id={id}
            active={activePresetId === id}
            onClick={() => onPick(id)}
            label={t(`styling.presets.${id}.label`)}
            description={t(`styling.presets.${id}.desc`)}
          />
        ))}
      </div>
      {activePresetId === "custom" && (
        <p className="mt-4 text-xs text-foreground/50">
          {t("styling.presets.customNotice")}
        </p>
      )}
    </Section>
  );
}

function PresetCard({
  id,
  label,
  description,
  active,
  onClick,
}: {
  id: PresetId;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  const preset = THEME_PRESETS[id];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border p-4 text-left transition-all",
        active
          ? "border-crown shadow-[0_0_24px_-6px_rgba(212,175,55,0.6)]"
          : "border-border/60 hover:border-crown/40",
      )}
      style={{
        background: preset.colors.background,
        color: preset.colors.foreground,
        fontFamily: preset.fonts.sans,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className="h-3 w-8 rounded-full"
          style={{ background: preset.colors.accent }}
        />
      </div>
      <p
        className="mt-2 text-xs opacity-70"
        style={{ color: preset.colors.foreground }}
      >
        {description}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {[
          preset.colors.primary,
          preset.colors.accent,
          preset.colors.muted,
          preset.colors.border,
          preset.colors.destructive,
        ].map((c, i) => (
          <span
            key={`${id}-swatch-${i}`}
            className="h-5 w-5 rounded-full border"
            style={{
              background: c,
              borderColor: preset.colors.border,
            }}
            aria-hidden
          />
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <span
          className="inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold"
          style={{
            background: preset.colors.primary,
            color: preset.colors.background,
            borderRadius: preset.radius.md,
          }}
        >
          Primary
        </span>
        <span
          className="inline-flex h-8 items-center rounded-md border px-3 text-xs"
          style={{
            borderColor: preset.colors.border,
            color: preset.colors.foreground,
            borderRadius: preset.radius.md,
          }}
        >
          Ghost
        </span>
      </div>
      {active && (
        <span className="absolute right-3 top-3 rounded-full bg-crown/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-black">
          active
        </span>
      )}
    </button>
  );
}

// ============================================================
// Live preview
// ============================================================

function LivePreview() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="crown">{t("styling.preview.primary")}</Button>
        <Button variant="outline">{t("styling.preview.outline")}</Button>
        <Button variant="ghost">{t("styling.preview.ghost")}</Button>
        <span
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-1 text-xs"
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--accent-hex)" }}
          />
          {t("styling.preview.badge")}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>{t("styling.preview.cardTitle")}</CardTitle>
          <CardDescription>
            {t("styling.preview.cardDesc")}
          </CardDescription>
          <div className="mt-4 flex items-center gap-2">
            <Input placeholder={t("styling.preview.inputPh")} />
            <Button variant="crown" size="sm">
              {t("styling.preview.submit")}
            </Button>
          </div>
        </Card>
        <div
          className="flex flex-col justify-between rounded-xl border p-6"
          style={{
            borderColor: "var(--border-hex)",
            background: "var(--muted-hex)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--effect-glow)",
          }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
              {t("styling.preview.walletEyebrow")}
            </p>
            <p
              className="mt-2 text-2xl font-semibold"
              style={{ fontFamily: "var(--font-display, var(--font-sans))" }}
            >
              1 337.42 KRN
            </p>
          </div>
          <div
            className="mt-6 font-mono text-xs"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            krwn1usr 4fa9 1c0d 8e… 2b1a
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Primitives
// ============================================================

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      {children}
    </main>
  );
}

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>{t("styling.token.title")}</CardTitle>
      <CardDescription>
        {t("styling.token.desc", { perm: "state.configure" })}
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
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-6">
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

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={normaliseColorInput(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background"
          aria-label={label}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono uppercase"
        />
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
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

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
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
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
          {label}
        </label>
        <span className="font-mono text-xs text-foreground/70">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-crown"
      />
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

const SANS_STACKS: Record<string, string> = {
  inter: "Inter, system-ui, sans-serif",
  system: "system-ui, -apple-system, sans-serif",
  "space-grotesk": "'Space Grotesk', Inter, system-ui, sans-serif",
  cormorant: "'Cormorant Garamond', 'Inter', serif",
  "sf-pro": "'SF Pro Text', 'Inter', system-ui, sans-serif",
  "jetbrains-mono":
    "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
};

const MONO_STACKS: Record<string, string> = {
  "jetbrains-mono":
    "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  "sf-mono": "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
  "fira-code": "'Fira Code', ui-monospace, monospace",
  monospace: "ui-monospace, SFMono-Regular, monospace",
};

function pickStackId(
  value: string,
  stacks: Record<string, string>,
): string {
  for (const [id, stack] of Object.entries(stacks)) {
    if (stack === value) return id;
  }
  return Object.keys(stacks)[0] ?? "inter";
}

function normaliseColorInput(value: string): string {
  if (typeof value !== "string") return "#000000";
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, a, b, c] = trimmed;
    return `#${a}${a}${b}${b}${c}${c}`;
  }
  return "#000000";
}

function remToPx(rem: string): number {
  const trimmed = rem.trim();
  if (trimmed.endsWith("rem")) {
    const n = parseFloat(trimmed);
    return Math.round((Number.isFinite(n) ? n : 0) * 16);
  }
  if (trimmed.endsWith("px")) {
    const n = parseFloat(trimmed);
    return Math.round(Number.isFinite(n) ? n : 0);
  }
  return 0;
}

function pxToRem(px: number): string {
  return `${Math.max(0, px) / 16}rem`;
}

// Guard against unused imports during tree-shaking.
void DEFAULT_THEME_CONFIG;
