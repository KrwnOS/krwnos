/**
 * `@/core/providers/theme-provider`
 * ------------------------------------------------------------
 * Канонический публичный путь для импорта Theme Engine-провайдера.
 * Сама реализация (`ThemeProvider`, `ThemeStyleTag`, `useTheme`,
 * `ThemeContextValue`, `ThemeTokenPatch`) живёт в одном модуле —
 * `src/core/theme-provider.tsx`, — чтобы не дублировать код.
 *
 * Этот файл существует как «вход с вестибюля»: модули должны
 * импортировать тему из `@/core/providers/theme-provider`, потому
 * что впоследствии сюда же переедут другие рантайм-провайдеры
 * (RBAC / Event Bus / Feature Flags) — они живут на клиенте, как
 * и Theme Engine.
 *
 *   import { ThemeProvider, useTheme } from "@/core/providers/theme-provider";
 */

"use client";

export {
  ThemeProvider,
  ThemeStyleTag,
  useTheme,
  type ThemeContextValue,
  type ThemeProviderProps,
  type ThemeTokenPatch,
} from "../theme-provider";
