/**
 * Server-side helper to load the active State's theme from the DB.
 * ------------------------------------------------------------
 * KrwnOS однопользовательский в пределах инстанса: один Суверен —
 * одно Государство, всё крутится под его темой. Здесь мы достаём
 * ПЕРВУЮ строку `State` (на ранних этапах их всегда одна штука) и
 * возвращаем нормализованный `ThemeConfig`.
 *
 * Если БД ещё не инициализирована (первый запуск до `setup`), мы
 * тихо возвращаем `DEFAULT_THEME_CONFIG` — страница /setup должна
 * быть рендерится в эталонной Minimalist High-Tech теме.
 *
 * Все ошибки подавляются — мы никогда не ломаем рендер ради того,
 * чтобы что-то красить. В худшем случае получаем дефолт.
 */

import { prisma } from "@/lib/prisma";
import {
  DEFAULT_THEME_CONFIG,
  normaliseThemeConfig,
  type ThemeConfig,
} from "@/core/theme";

export async function loadActiveTheme(): Promise<ThemeConfig> {
  try {
    const row = (await (prisma as unknown as {
      state: {
        findFirst: (args: {
          orderBy: { createdAt: "asc" | "desc" };
          select: { id: true; themeConfig: true };
        }) => Promise<{ id: string; themeConfig: unknown } | null>;
      };
    }).state.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, themeConfig: true },
    })) as { id: string; themeConfig: unknown } | null;

    if (!row) return DEFAULT_THEME_CONFIG;
    return normaliseThemeConfig(row.themeConfig);
  } catch {
    return DEFAULT_THEME_CONFIG;
  }
}

export async function loadThemeForState(
  stateId: string,
): Promise<ThemeConfig> {
  try {
    const row = (await (prisma as unknown as {
      state: {
        findUnique: (args: {
          where: { id: string };
          select: { themeConfig: true };
        }) => Promise<{ themeConfig: unknown } | null>;
      };
    }).state.findUnique({
      where: { id: stateId },
      select: { themeConfig: true },
    })) as { themeConfig: unknown } | null;

    if (!row) return DEFAULT_THEME_CONFIG;
    return normaliseThemeConfig(row.themeConfig);
  } catch {
    return DEFAULT_THEME_CONFIG;
  }
}
