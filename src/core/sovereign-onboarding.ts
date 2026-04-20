/**
 * Persisted in `StateSettings.extras` — one completion timestamp per userId
 * (Sovereign or delegated `state.configure` completing the first-run tour).
 */

export const SOVEREIGN_ONBOARDING_EXTRAS_KEY = "sovereignOnboardingByUser" as const;

export function isSovereignOnboardingComplete(
  extras: Record<string, unknown> | undefined,
  userId: string,
): boolean {
  if (!extras) return false;
  const raw = extras[SOVEREIGN_ONBOARDING_EXTRAS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return typeof (raw as Record<string, unknown>)[userId] === "string";
}

export function markSovereignOnboardingComplete(
  extras: Record<string, unknown> | undefined,
  userId: string,
): Record<string, unknown> {
  const base = extras && typeof extras === "object" && !Array.isArray(extras)
    ? { ...extras }
    : {};
  const prevRaw = base[SOVEREIGN_ONBOARDING_EXTRAS_KEY];
  const prev =
    prevRaw &&
    typeof prevRaw === "object" &&
    !Array.isArray(prevRaw)
      ? { ...(prevRaw as Record<string, unknown>) }
      : {};
  prev[userId] = new Date().toISOString();
  return {
    ...base,
    [SOVEREIGN_ONBOARDING_EXTRAS_KEY]: prev,
  };
}
