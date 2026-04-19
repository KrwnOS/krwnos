import type { Config } from "tailwindcss";

/**
 * Tailwind-конфиг KrwnOS.
 * ------------------------------------------------------------
 * Все базовые цвета привязаны к CSS-переменным, которые
 * пишет `ThemeProvider` (`src/core/theme-provider.tsx`). Формат
 * `hsl(var(--X) / <alpha-value>)` нужен, чтобы Tailwind-утилиты
 * `bg-primary/80`, `text-foreground/60` и т.д. продолжали
 * работать с любыми темами — ThemeProvider хранит цвет как
 * HSL-тройку (см. `hexToHslTriple` в `src/core/theme.ts`).
 *
 * Для случаев, когда нужен сырой hex (градиенты, свечения),
 * ThemeProvider дополнительно экспортирует `--<name>-hex` —
 * см. `renderThemeCss()`.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/modules/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        // Surface / панели / модалки — Slate Gray в дефолтной теме.
        card: "hsl(var(--card) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        // Primary / CTA — Gold в дефолтной теме.
        primary: "hsl(var(--primary) / <alpha-value>)",
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        // Лонжерон бренда — фиксированные hex-акценты, которые
        // используются, когда нужен именно «корона KrwnOS» поверх
        // любой темы (логотип в шапке, аватары, badges).
        crown: {
          DEFAULT: "#D4AF37",
          soft: "#F4E5A1",
          dark: "#8C6A10",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
