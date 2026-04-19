/**
 * ThemeProvider — клиентский движок тем.
 * ------------------------------------------------------------
 * Оборачивает всё приложение (см. `src/app/layout.tsx`), держит
 * в стейте текущий `ThemeConfig` и динамически инъектит в `<head>`
 * тег `<style id="krwn-theme">` с CSS-переменными `:root`.
 *
 * Почему провайдер клиентский, а не просто SSR-теговый:
 *   1. Любой модуль («Визуальный конструктор», onboarding-wizard,
 *      админка) может через `useTheme().setTheme(next)` мгновенно
 *      перерендерить всю ОС — никаких моргающих рефрешей.
 *   2. Бродкаст через `BroadcastChannel`: если у Суверена открыто
 *      несколько вкладок KrwnOS, смена темы в одной мгновенно
 *      долетает до других.
 *   3. SSR всё равно рендерит первый экран в серверно-сгенерированном
 *      CSS (layout.tsx вставляет `<style>` c server-side рендером
 *      темы), поэтому hydration не показывает flash-of-unstyled.
 *
 * Публичные контракты:
 *   * `<ThemeProvider initial={theme}>children</ThemeProvider>`
 *   * `useTheme(): { theme, setTheme, applyPreset, resetTheme,
 *                    mergeTokens }`
 */

"use client";

import * as React from "react";
import {
  DEFAULT_THEME_CONFIG,
  THEME_PRESETS,
  cloneTheme,
  getPreset,
  normaliseThemeConfig,
  renderThemeCss,
  type ThemeConfig,
  type ThemePresetId,
} from "./theme";

// ============================================================
// Context
// ============================================================

export interface ThemeContextValue {
  theme: ThemeConfig;
  /** Полностью заменить тему (живьём). */
  setTheme: (next: ThemeConfig) => void;
  /** Переключиться на один из пресетов (сбрасывает все кастомные токены). */
  applyPreset: (id: Exclude<ThemePresetId, "custom">) => void;
  /** Мердж отдельных токенов поверх текущей темы — для live-preview слайдеров. */
  mergeTokens: (patch: ThemeTokenPatch) => void;
  /** Вернуть к Minimalist High-Tech. */
  resetTheme: () => void;
}

export interface ThemeTokenPatch {
  preset?: ThemePresetId;
  colors?: Partial<ThemeConfig["colors"]>;
  fonts?: Partial<ThemeConfig["fonts"]>;
  radius?: Partial<ThemeConfig["radius"]>;
  effects?: Partial<NonNullable<ThemeConfig["effects"]>>;
  customCss?: string;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      "useTheme() must be called inside <ThemeProvider>. Check that " +
        "your root layout wraps children with <ThemeProvider>.",
    );
  }
  return ctx;
}

// ============================================================
// Provider
// ============================================================

export interface ThemeProviderProps {
  /**
   * Стартовая тема. Приходит из SSR (layout.tsx читает её из
   * `State.themeConfig`). Если в рантайме прилетит новый JSON
   * через `setTheme`, мы перекрасим всё мгновенно.
   */
  initial?: ThemeConfig;
  /**
   * Канал для межвкладочной синхронизации. `null` — отключает
   * BroadcastChannel (удобно для тестов и SSR-only страниц).
   * По умолчанию — `"krwn.theme"`.
   */
  broadcastChannel?: string | null;
  children: React.ReactNode;
}

const STYLE_TAG_ID = "krwn-theme";

export function ThemeProvider({
  initial,
  broadcastChannel = "krwn.theme",
  children,
}: ThemeProviderProps) {
  // Нормализуем initial — защищаемся от того, что SSR подсунет
  // `undefined` или кривой объект.
  const [theme, setThemeState] = React.useState<ThemeConfig>(() =>
    normaliseThemeConfig(initial ?? DEFAULT_THEME_CONFIG),
  );

  // --- Инъекция CSS в <head> ---
  //
  // Важно: именно useLayoutEffect. Если использовать useEffect, при
  // смене темы успеет прорисоваться один кадр в старых стилях — и
  // пользователь увидит «моргание». В SSR-ветке React проигнорирует
  // этот hook автоматически (сервер рендерит <style> через layout).
  const useIsomorphicLayoutEffect =
    typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

  useIsomorphicLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const css = renderThemeCss(theme);
    let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = STYLE_TAG_ID;
      tag.setAttribute("data-krwn", "theme");
      document.head.appendChild(tag);
    }
    if (tag.textContent !== css) tag.textContent = css;
  }, [theme]);

  // --- Мульти-вкладочная синхронизация через BroadcastChannel ---
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  React.useEffect(() => {
    if (!broadcastChannel || typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(broadcastChannel);
    channelRef.current = channel;
    channel.onmessage = (ev) => {
      const data = ev.data as { type?: string; theme?: unknown } | null;
      if (data && data.type === "krwn.theme.update") {
        setThemeState(normaliseThemeConfig(data.theme));
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [broadcastChannel]);

  // --- API ---
  const setTheme = React.useCallback((next: ThemeConfig) => {
    const normalised = normaliseThemeConfig(next);
    setThemeState(normalised);
    channelRef.current?.postMessage({
      type: "krwn.theme.update",
      theme: normalised,
    });
  }, []);

  const applyPreset = React.useCallback(
    (id: Exclude<ThemePresetId, "custom">) => {
      const preset = THEME_PRESETS[id];
      if (!preset) return;
      setTheme(cloneTheme(preset));
    },
    [setTheme],
  );

  const mergeTokens = React.useCallback(
    (patch: ThemeTokenPatch) => {
      setThemeState((prev) => {
        // Любой ручной патч съезжает в "custom" — пресет больше не
        // описывает тему точно, UI должен показать «отредактирован».
        const next: ThemeConfig = cloneTheme(prev);
        if (patch.preset !== undefined) next.preset = patch.preset;
        else if (prev.preset !== "custom") next.preset = "custom";

        if (patch.colors) {
          next.colors = { ...prev.colors, ...patch.colors };
        }
        if (patch.fonts) {
          next.fonts = { ...prev.fonts, ...patch.fonts };
        }
        if (patch.radius) {
          next.radius = { ...prev.radius, ...patch.radius };
        }
        if (patch.effects) {
          next.effects = { ...(prev.effects ?? {}), ...patch.effects };
        }
        if (patch.customCss !== undefined) {
          next.customCss = patch.customCss;
        }
        const normalised = normaliseThemeConfig(next);
        channelRef.current?.postMessage({
          type: "krwn.theme.update",
          theme: normalised,
        });
        return normalised;
      });
    },
    [],
  );

  const resetTheme = React.useCallback(() => {
    setTheme(getPreset("minimal-hightech"));
  }, [setTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, applyPreset, mergeTokens, resetTheme }),
    [theme, setTheme, applyPreset, mergeTokens, resetTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ============================================================
// Server-side helper
// ============================================================

/**
 * Возвращает JSX-тег `<style>` с CSS-переменными для первого
 * кадра страницы. Используется в серверном `layout.tsx`, чтобы
 * SSR-контент сразу отрисовался в нужной теме — без хайдрейшн-
 * глитчей.
 *
 * Ставим `suppressHydrationWarning`, потому что клиентский
 * ThemeProvider может переписать содержимое тега.
 */
export function ThemeStyleTag({ theme }: { theme: ThemeConfig }) {
  const css = renderThemeCss(normaliseThemeConfig(theme));
  return (
    <style
      id={STYLE_TAG_ID}
      data-krwn="theme"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
