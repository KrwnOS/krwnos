/**
 * `/admin/constitution` — Палата Указов (Sovereign's Decree).
 * ------------------------------------------------------------
 * Витрина для Суверена, где он программирует государство
 * целиком: фискальная политика, правила входа/выхода, динамика
 * Вертикали. Формирует один PATCH-запрос в
 * `/api/state/constitution` при нажатии «Подписать указ».
 *
 * Транспорт идентичен `/admin/economy`: CLI-токен Суверена
 * хранится в `localStorage["krwn.token"]`, каждый fetch
 * отправляет Bearer. Серверный guard (StateConfigService) сам
 * отбрасывает все не-Sovereign запросы с 403.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Wire types
// ------------------------------------------------------------

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
  transactionTaxRate: number;
  incomeTaxRate: number;
  roleTaxRate: number;
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

const GOVERNANCE_MANAGEABLE_KEY_LABELS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "transactionTaxRate", label: "Налог на перевод" },
  { key: "incomeTaxRate", label: "Подоходный налог" },
  { key: "roleTaxRate", label: "Налог на роль" },
  { key: "currencyDisplayName", label: "Витрина валюты" },
  { key: "citizenshipFeeAmount", label: "Плата за гражданство" },
  { key: "rolesPurchasable", label: "Выкуп ролей" },
  { key: "exitRefundRate", label: "Возврат при выходе" },
  { key: "permissionInheritance", label: "Наследование прав" },
  { key: "autoPromotionEnabled", label: "Авто-продвижение: вкл." },
  { key: "autoPromotionMinBalance", label: "Авто-продвижение: баланс" },
  { key: "autoPromotionMinDays", label: "Авто-продвижение: стаж" },
  { key: "autoPromotionTargetNodeId", label: "Авто-продвижение: узел" },
  { key: "treasuryTransparency", label: "Прозрачность казны" },
];

interface FormState {
  transactionTaxPct: string;
  incomeTaxPct: string;
  roleTaxPct: string;
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

  // Governance — «конституция самого голосования». UI хранит
  // проценты и дни, вычислители переводят в bps / секунды перед
  // отправкой. Это даёт Суверену привычные единицы измерения.
  governanceMode: GovernanceMode;
  governanceSovereignVeto: boolean;
  governanceQuorumPct: string;
  governanceThresholdPct: string;
  governanceDurationDays: string;
  governanceWeightStrategy: WeightStrategy;
  governanceMinProposerBalance: string;
  governanceAllowedKeys: Record<string, boolean>;
}

const TOKEN_STORAGE_KEY = "krwn.token";

function toForm(settings: StateSettingsDto): FormState {
  const g = settings.governanceRules;
  const wildcard = g.allowedConfigKeys.includes("*");
  const allowedSet = new Set(g.allowedConfigKeys);
  const allowed: Record<string, boolean> = {};
  for (const { key } of GOVERNANCE_MANAGEABLE_KEY_LABELS) {
    allowed[key] = wildcard || allowedSet.has(key);
  }
  return {
    transactionTaxPct: (settings.transactionTaxRate * 100).toString(),
    incomeTaxPct: (settings.incomeTaxRate * 100).toString(),
    roleTaxPct: (settings.roleTaxRate * 100).toString(),
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

// ------------------------------------------------------------

export default function AdminConstitutionPage() {
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
        setFlash("Указ подписан и вступил в силу.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
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
            Палата Указов
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Конституция государства</h1>
          <p className="mt-2 max-w-2xl text-sm text-foreground/60">
            Здесь Суверен задаёт правила, по которым живёт песочница:
            фискальную политику, правила входа, динамику Вертикали. Любое
            изменение мгновенно применяется к каждому переводу, инвайту и
            проверке прав.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? "…" : "Обновить"}
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
            Сменить токен
          </Button>
        </div>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          Ошибка: {error}. Для редактирования требуется CLI-токен Суверена или
          держателя права <code>state.configure</code>.
        </Card>
      )}

      {flash && (
        <Card className="mb-6 border-crown/40 bg-crown/5 text-sm text-crown">
          {flash}
        </Card>
      )}

      {!form && !error && (
        <Card className="text-sm text-foreground/60">Загружаем конституцию…</Card>
      )}

      {form && (
        <form className="space-y-6" onSubmit={onSubmit}>
          <Section
            eyebrow="Глава I"
            title="Фискальная политика"
            description={
              "Три налоговых слоя. Налог на транзакции применяется к любому " +
              "переводу между гражданами. Подоходный — к выплатам из казны " +
              "на личный кошелёк. Налог на роль хранится как декларация: его " +
              "автоматически спишет cron-механика более поздних релизов."
            }
          >
            <Grid3>
              <NumberField
                label="Налог на перевод (%)"
                hint="С каждой P2P-операции уходит в корневую Казну."
                value={form.transactionTaxPct}
                onChange={(v) => setForm({ ...form, transactionTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <NumberField
                label="Подоходный налог (%)"
                hint="С начислений из казны на личный кошелёк."
                value={form.incomeTaxPct}
                onChange={(v) => setForm({ ...form, incomeTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <NumberField
                label="Налог на роль (%/мес)"
                hint="Месячная подписка на удержание высокой позиции."
                value={form.roleTaxPct}
                onChange={(v) => setForm({ ...form, roleTaxPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
            </Grid3>
            <div className="mt-4">
              <TextField
                label="Витрина названия валюты"
                hint={
                  "Необязательная подпись для UI. Настоящая единица учёта " +
                  "остаётся в Фабрике Валют (тикер первичного актива)."
                }
                value={form.currencyDisplayName}
                onChange={(v) => setForm({ ...form, currencyDisplayName: v })}
                placeholder="Королевская Крона"
              />
            </div>
          </Section>

          <Section
            eyebrow="Глава II"
            title="Правила входа и выхода"
            description={
              "Плата за гражданство защищает от спама. Выкуп ролей позволяет " +
              "превратить Вертикаль в биржу статусов. Возврат при выходе " +
              "определяет, считается ли эмиграция легитимной."
            }
          >
            <Grid3>
              <NumberField
                label="Плата за гражданство"
                hint="В единицах первичной валюты. 0 = бесплатный вход."
                value={form.citizenshipFeeAmount}
                onChange={(v) =>
                  setForm({ ...form, citizenshipFeeAmount: v })
                }
                min={0}
                step={1}
              />
              <NumberField
                label="Возврат при выходе (%)"
                hint="Доля остатка, возвращаемая эмигранту."
                value={form.exitRefundPct}
                onChange={(v) => setForm({ ...form, exitRefundPct: v })}
                min={0}
                max={100}
                step={0.1}
              />
              <ToggleField
                label="Выкуп ролей разрешён"
                hint="Позволяет выставить узел Вертикали на продажу."
                checked={form.rolesPurchasable}
                onChange={(v) =>
                  setForm({ ...form, rolesPurchasable: v })
                }
              />
            </Grid3>
          </Section>

          <Section
            eyebrow="Глава III"
            title="Динамика Вертикали"
            description={
              "Определяет, как власть и прозрачность распределяются «сами " +
              "собой». Наследование прав превращает министров в видящих всё " +
              "в подразделении. Авто-продвижение назначает гражданину новую " +
              "должность при выполнении условий."
            }
          >
            <Grid3>
              <ToggleField
                label="Наследование прав"
                hint="Министр видит всё, что видят его подчинённые."
                checked={form.permissionInheritance}
                onChange={(v) =>
                  setForm({ ...form, permissionInheritance: v })
                }
              />
              <ToggleField
                label="Авто-продвижение"
                hint="Автоматически переводит гражданина в целевой узел."
                checked={form.autoPromotionEnabled}
                onChange={(v) =>
                  setForm({ ...form, autoPromotionEnabled: v })
                }
              />
              <SelectField
                label="Прозрачность казны"
                hint="Кто видит TreasuryWallet и его историю."
                value={form.treasuryTransparency}
                onChange={(v) =>
                  setForm({
                    ...form,
                    treasuryTransparency: v as TreasuryTransparency,
                  })
                }
                options={[
                  { value: "public", label: "Публичная — все граждане" },
                  { value: "council", label: "Совет — узел и предки" },
                  { value: "sovereign", label: "Только Суверен" },
                ]}
              />
            </Grid3>

            {form.autoPromotionEnabled && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <NumberField
                  label="Порог баланса"
                  hint="Минимум средств для авто-повышения."
                  value={form.autoPromotionMinBalance}
                  onChange={(v) =>
                    setForm({ ...form, autoPromotionMinBalance: v })
                  }
                  min={0}
                  step={1}
                />
                <NumberField
                  label="Стаж, дней"
                  hint="Сколько дней в системе должен провести гражданин."
                  value={form.autoPromotionMinDays}
                  onChange={(v) =>
                    setForm({ ...form, autoPromotionMinDays: v })
                  }
                  min={0}
                  step={1}
                />
                <TextField
                  label="Целевой узел (id)"
                  hint="cuid узла Вертикали. Возьмите из /admin/vertical."
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
            eyebrow="Глава IV"
            title="Парламент"
            description={
              "Включает или отключает прямую демократию. В режиме «Указ» " +
              "предложения граждан остаются декларациями. В «Консультации» " +
              "Суверен видит итоги и принимает решение вручную. В " +
              "«Авто-DAO» успешные голосования меняют конституцию сами — но " +
              "право вето Суверена по-прежнему доступно, если не выключено."
            }
          >
            <Grid3>
              <SelectField
                label="Режим управления"
                hint="Определяет, влияют ли голоса граждан на state settings."
                value={form.governanceMode}
                onChange={(v) =>
                  setForm({ ...form, governanceMode: v as GovernanceMode })
                }
                options={[
                  { value: "decree", label: "Указ — только Суверен" },
                  {
                    value: "consultation",
                    label: "Консультация — вручную",
                  },
                  { value: "auto_dao", label: "Auto-DAO — автоматически" },
                ]}
              />
              <ToggleField
                label="Право вето Суверена"
                hint="Разрешает Суверену наложить вето на любое решение."
                checked={form.governanceSovereignVeto}
                onChange={(v) =>
                  setForm({ ...form, governanceSovereignVeto: v })
                }
              />
              <SelectField
                label="Вес голоса"
                hint="Как система считает вклад каждого голосующего."
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
                    label: "Один человек — один голос",
                  },
                  {
                    value: "by_node_weight",
                    label: "По весу узла Вертикали",
                  },
                  {
                    value: "by_balance",
                    label: "По балансу первичного актива",
                  },
                ]}
              />
            </Grid3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <NumberField
                label="Кворум (%)"
                hint="Минимальная доля электората, подавшая голос."
                value={form.governanceQuorumPct}
                onChange={(v) =>
                  setForm({ ...form, governanceQuorumPct: v })
                }
                min={0}
                max={100}
                step={0.5}
              />
              <NumberField
                label="Порог «за» (%)"
                hint="Доля «за» от общего числа поданных голосов."
                value={form.governanceThresholdPct}
                onChange={(v) =>
                  setForm({ ...form, governanceThresholdPct: v })
                }
                min={0}
                max={100}
                step={0.5}
              />
              <NumberField
                label="Длительность, дни"
                hint="Сколько длится голосование от создания до автозакрытия."
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
                label="Мин. баланс для создания предложения"
                hint="Anti-spam: сколько первичной валюты нужно иметь. Пусто = не ограничивать."
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
                Параметры, отдаваемые Парламенту
              </p>
              <p className="mt-1 text-xs text-foreground/50">
                Отмеченные ключи граждане смогут предложить изменить
                через <a href="/governance" className="underline decoration-dotted">Парламент</a>.
                Снимите все галочки, чтобы оставить Парламент декоративным.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {GOVERNANCE_MANAGEABLE_KEY_LABELS.map(({ key, label }) => (
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
                    <span className="flex-1 text-foreground/80">{label}</span>
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
                ? "Есть несохранённые изменения"
                : "Все поля синхронизированы с БД"}
            </p>
            <Button
              type="submit"
              variant="crown"
              disabled={!dirty || saving}
              title={dirty ? undefined : "Измените любое поле, чтобы подписать указ"}
            >
              {saving ? "Подписываю…" : "Подписать указ"}
            </Button>
          </div>
        </form>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function buildPatch(form: FormState): Record<string, unknown> {
  // Все ставки UI хранит в процентах, API — во фракции. Переводим
  // здесь — сервер-валидация отклонит любые значения вне [0..1].
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

  // Bps — «basis points» (0..10000). UI ведёт проценты с двумя
  // знаками, серверу отдаём целое bps.
  const toBps = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10_000, Math.round(n * 100)));
  };
  const toDurationSeconds = (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 3 * 86_400;
    // Clamp 1 минута .. 365 дней, чтобы пройти сервер-валидацию.
    const seconds = Math.round(n * 86_400);
    return Math.max(60, Math.min(60 * 60 * 24 * 365, seconds));
  };

  const allowedConfigKeys: string[] = [];
  for (const { key } of GOVERNANCE_MANAGEABLE_KEY_LABELS) {
    if (form.governanceAllowedKeys[key]) allowedConfigKeys.push(key);
  }

  return {
    transactionTaxRate: toFraction(form.transactionTaxPct),
    incomeTaxRate: toFraction(form.incomeTaxPct),
    roleTaxRate: toFraction(form.roleTaxPct),
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
  const [value, setValue] = useState("");
  return (
    <Card className="mx-auto mt-24 max-w-md">
      <CardTitle>Вход в Палату Указов</CardTitle>
      <CardDescription>
        Редактирование конституции требует CLI-токен Суверена (или держателя
        права <code>state.configure</code>). Получите его через{" "}
        <code>krwn token mint</code>.
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
          Войти
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
    <Card>
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
