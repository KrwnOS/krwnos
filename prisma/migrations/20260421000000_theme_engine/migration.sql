-- ============================================================
-- Theme Engine (Движок Тем).
-- ------------------------------------------------------------
-- Добавляет `State.themeConfig` (JSONB) — свод динамических
-- дизайн-токенов, который ThemeProvider в ядре превращает в
-- CSS-переменные `:root` для всех модулей одновременно.
--
-- Default — пресет "Minimalist High-Tech":
--   * background (Anthracite)    #0A0A0A
--   * foreground (Silver)        #E2E2E2
--   * card       (Slate Gray)    #1E1E1E
--   * primary / accent (Gold)    #D4AF37
--   * radius.md                  0.5rem
--
-- Форма JSON:
--   {
--     "preset": "minimal-hightech" | "terminal" | "glass"
--               | "royal-gold" | "cyberpunk" | "custom",
--     "colors": { background, foreground, card, muted, border,
--                 accent, primary, destructive },   // hex
--     "fonts":  { sans, mono, display? },
--     "radius": { sm, md, lg },                     // rem
--     "effects":{ blur, glow },
--     "customCss": ""                               // сырой CSS
--   }
--
-- Валидация формы — в `src/core/theme.ts` (`validateThemeConfig`).
-- Существующие State получают тот же default через backfill ниже.
-- ============================================================

-- AddColumn
ALTER TABLE "State"
    ADD COLUMN IF NOT EXISTS "themeConfig" JSONB NOT NULL DEFAULT
      '{"preset":"minimal-hightech","colors":{"background":"#0A0A0A","foreground":"#E2E2E2","card":"#1E1E1E","muted":"#141414","border":"#2A2A2A","accent":"#D4AF37","primary":"#D4AF37","destructive":"#E5484D"},"fonts":{"sans":"Inter, system-ui, sans-serif","mono":"''JetBrains Mono'', ui-monospace, monospace"},"radius":{"sm":"0.25rem","md":"0.5rem","lg":"0.75rem"},"effects":{"blur":"12px","glow":"0 0 24px -6px rgba(212,175,55,0.45)"},"customCss":""}'::jsonb;

-- Backfill: state rows that predate this migration already got the
-- DEFAULT above, but if the column existed as NULL somewhere we
-- normalise it to the canonical default.
UPDATE "State"
SET "themeConfig" =
  '{"preset":"minimal-hightech","colors":{"background":"#0A0A0A","foreground":"#E2E2E2","card":"#1E1E1E","muted":"#141414","border":"#2A2A2A","accent":"#D4AF37","primary":"#D4AF37","destructive":"#E5484D"},"fonts":{"sans":"Inter, system-ui, sans-serif","mono":"''JetBrains Mono'', ui-monospace, monospace"},"radius":{"sm":"0.25rem","md":"0.5rem","lg":"0.75rem"},"effects":{"blur":"12px","glow":"0 0 24px -6px rgba(212,175,55,0.45)"},"customCss":""}'::jsonb
WHERE "themeConfig" IS NULL OR "themeConfig" = '{}'::jsonb;
