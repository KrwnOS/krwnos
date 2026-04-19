/**
 * Unit tests for the Theme Engine (`src/core/theme.ts`).
 *
 * Покрываем все три фронта:
 *   * галерея пресетов и их базовая форма;
 *   * normaliseThemeConfig — «never throws» контракт на сырых JSON;
 *   * validateThemeConfig — строгая форма для PATCH-ов;
 *   * renderThemeCss — детерминированный вывод токенов;
 *   * hex↔hsl и sanitiseCustomCss как pure-helpers.
 */

import { describe, expect, it } from "vitest";
import {
  CYBERPUNK_THEME,
  DEFAULT_THEME_CONFIG,
  GLASS_THEME,
  MINIMAL_HIGHTECH_THEME,
  ROYAL_GOLD_THEME,
  TERMINAL_THEME,
  THEME_PRESETS,
  THEME_PRESET_ORDER,
  ThemeValidationError,
  cloneTheme,
  getPreset,
  hexToHslTriple,
  isPresetId,
  normaliseThemeConfig,
  renderThemeCss,
  sanitiseCustomCss,
  validateThemeConfig,
  type ThemeConfig,
} from "../theme";

// ------------------------------------------------------------
// Presets
// ------------------------------------------------------------

describe("Theme presets", () => {
  it("exports five canonical presets in declared order", () => {
    expect(THEME_PRESET_ORDER).toEqual([
      "minimal-hightech",
      "terminal",
      "glass",
      "royal-gold",
      "cyberpunk",
    ]);
    for (const id of THEME_PRESET_ORDER) {
      expect(THEME_PRESETS[id]).toBeDefined();
      expect(THEME_PRESETS[id].preset).toBe(id);
    }
  });

  it("uses minimal-hightech as the default", () => {
    expect(DEFAULT_THEME_CONFIG).toBe(MINIMAL_HIGHTECH_THEME);
  });

  it("every preset provides 8 mandatory color tokens", () => {
    const required: Array<keyof ThemeConfig["colors"]> = [
      "background",
      "foreground",
      "card",
      "muted",
      "border",
      "accent",
      "primary",
      "destructive",
    ];
    for (const theme of [
      MINIMAL_HIGHTECH_THEME,
      TERMINAL_THEME,
      GLASS_THEME,
      ROYAL_GOLD_THEME,
      CYBERPUNK_THEME,
    ]) {
      for (const k of required) {
        expect(theme.colors[k]).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});

// ------------------------------------------------------------
// isPresetId
// ------------------------------------------------------------

describe("isPresetId", () => {
  it("accepts canonical ids and 'custom'", () => {
    expect(isPresetId("minimal-hightech")).toBe(true);
    expect(isPresetId("terminal")).toBe(true);
    expect(isPresetId("glass")).toBe(true);
    expect(isPresetId("royal-gold")).toBe(true);
    expect(isPresetId("cyberpunk")).toBe(true);
    expect(isPresetId("custom")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPresetId("something")).toBe(false);
    expect(isPresetId(123)).toBe(false);
    expect(isPresetId(null)).toBe(false);
    expect(isPresetId(undefined)).toBe(false);
    expect(isPresetId({})).toBe(false);
  });
});

// ------------------------------------------------------------
// getPreset / cloneTheme
// ------------------------------------------------------------

describe("getPreset / cloneTheme", () => {
  it("getPreset('custom') returns a clone of the default", () => {
    const cloned = getPreset("custom");
    expect(cloned.preset).toBe("minimal-hightech");
    expect(cloned).not.toBe(DEFAULT_THEME_CONFIG);
    expect(cloned.colors).not.toBe(DEFAULT_THEME_CONFIG.colors);
  });

  it("getPreset returns an editable copy, not the original", () => {
    const copy = getPreset("terminal");
    copy.colors.accent = "#000000";
    expect(TERMINAL_THEME.colors.accent).not.toBe("#000000");
  });

  it("cloneTheme preserves effects + customCss, nullifies missing effects", () => {
    const base: ThemeConfig = {
      preset: "custom",
      colors: { ...MINIMAL_HIGHTECH_THEME.colors },
      fonts: { ...MINIMAL_HIGHTECH_THEME.fonts },
      radius: { ...MINIMAL_HIGHTECH_THEME.radius },
      customCss: "body{color:red;}",
    };
    const c = cloneTheme(base);
    expect(c.effects).toEqual({});
    expect(c.customCss).toBe("body{color:red;}");
  });
});

// ------------------------------------------------------------
// hexToHslTriple
// ------------------------------------------------------------

describe("hexToHslTriple", () => {
  it("handles pure primaries", () => {
    expect(hexToHslTriple("#FF0000")).toBe("0 100% 50%");
    expect(hexToHslTriple("#00FF00")).toBe("120 100% 50%");
    expect(hexToHslTriple("#0000FF")).toBe("240 100% 50%");
  });

  it("handles grey / white / black (delta === 0)", () => {
    expect(hexToHslTriple("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriple("#FFFFFF")).toBe("0 0% 100%");
    expect(hexToHslTriple("#808080")).toMatch(/^0 0% 50%$/);
  });

  it("expands 3-digit hex shorthand", () => {
    expect(hexToHslTriple("#F00")).toBe("0 100% 50%");
    expect(hexToHslTriple("#0F0")).toBe("120 100% 50%");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(hexToHslTriple("  #d4af37  ")).toMatch(/^\d+ \d+% \d+%$/);
  });

  it("returns a safe default for garbage", () => {
    expect(hexToHslTriple("notacolor")).toBe("0 0% 0%");
    expect(hexToHslTriple("")).toBe("0 0% 0%");
    expect(hexToHslTriple("#ZZZZZZ")).toBe("0 0% 0%");
  });
});

// ------------------------------------------------------------
// normaliseThemeConfig
// ------------------------------------------------------------

describe("normaliseThemeConfig", () => {
  it("returns the default on non-object input (never throws)", () => {
    expect(normaliseThemeConfig(null).preset).toBe("minimal-hightech");
    expect(normaliseThemeConfig(undefined).preset).toBe("minimal-hightech");
    expect(normaliseThemeConfig("hello").preset).toBe("minimal-hightech");
    expect(normaliseThemeConfig(42).preset).toBe("minimal-hightech");
    expect(normaliseThemeConfig([]).preset).toBe("minimal-hightech");
  });

  it("falls back to per-field defaults on missing keys", () => {
    const out = normaliseThemeConfig({ preset: "terminal" });
    expect(out.preset).toBe("terminal");
    expect(out.colors.accent).toBe(TERMINAL_THEME.colors.accent);
    expect(out.fonts.sans).toBe(TERMINAL_THEME.fonts.sans);
    expect(out.radius.md).toBe(TERMINAL_THEME.radius.md);
  });

  it("tolerates a missing colors.card by inheriting from muted", () => {
    const out = normaliseThemeConfig({
      preset: "custom",
      colors: { muted: "#ABCDEF" },
    });
    expect(out.colors.card).toBe("#ABCDEF");
  });

  it("sanitises dangerous customCss", () => {
    const raw = `</style><script>alert(1)</script>body{}<!--x-->`;
    const out = normaliseThemeConfig({ preset: "custom", customCss: raw });
    expect(out.customCss).not.toMatch(/<\/style>/i);
    expect(out.customCss).not.toMatch(/<script/i);
    expect(out.customCss).not.toMatch(/<!--/);
  });

  it("falls back when font value is unsafe", () => {
    const out = normaliseThemeConfig({
      preset: "custom",
      fonts: { sans: "Inter; body{display:none}", mono: "" },
    });
    expect(out.fonts.sans).toBe(MINIMAL_HIGHTECH_THEME.fonts.sans);
    expect(out.fonts.mono).toBe(MINIMAL_HIGHTECH_THEME.fonts.mono);
  });

  it("explicit null for display drops the font without error", () => {
    const out = normaliseThemeConfig({
      preset: "royal-gold",
      fonts: { display: null },
    });
    expect(out.fonts.display).toBeNull();
  });

  it("keeps effects.glow as-is when short, drops nonsense lengths", () => {
    const out = normaliseThemeConfig({
      preset: "custom",
      effects: { blur: "notalength", glow: "0 0 4px red" },
    });
    expect(out.effects?.blur).toBe("12px");
    expect(out.effects?.glow).toBe("0 0 4px red");
  });

  it("marks preset as 'custom' when unknown", () => {
    expect(normaliseThemeConfig({ preset: "bogus" }).preset).toBe("custom");
  });
});

// ------------------------------------------------------------
// validateThemeConfig
// ------------------------------------------------------------

describe("validateThemeConfig — strict", () => {
  const baseValid = () =>
    ({
      preset: "custom",
      colors: { ...MINIMAL_HIGHTECH_THEME.colors },
      fonts: { ...MINIMAL_HIGHTECH_THEME.fonts, display: null },
      radius: { ...MINIMAL_HIGHTECH_THEME.radius },
      effects: { blur: "10px", glow: "0 0 8px red" },
      customCss: "/* hi */",
    }) as const;

  it("accepts a well-formed object and echoes normalised values", () => {
    const v = validateThemeConfig(baseValid());
    expect(v.preset).toBe("custom");
    expect(v.colors.background).toBe("#0A0A0A");
    expect(v.fonts.display).toBeNull();
    expect(v.effects?.blur).toBe("10px");
    expect(v.customCss).toMatch(/hi/);
  });

  it("rejects non-object root", () => {
    expect(() => validateThemeConfig(null)).toThrow(ThemeValidationError);
    expect(() => validateThemeConfig("hello")).toThrow(ThemeValidationError);
    expect(() => validateThemeConfig([])).toThrow(ThemeValidationError);
  });

  it("rejects unknown preset", () => {
    const raw = { ...baseValid(), preset: "space" };
    expect(() => validateThemeConfig(raw)).toThrow(/preset must be one of/);
  });

  it("rejects non-hex colours", () => {
    const raw = { ...baseValid(), colors: { ...baseValid().colors, accent: "rgb(0,0,0)" } };
    expect(() => validateThemeConfig(raw)).toThrow(/hex color/);
  });

  it("rejects non-object subsections", () => {
    expect(() =>
      validateThemeConfig({ ...baseValid(), colors: "nope" }),
    ).toThrow(/colors must be a plain object/);
    expect(() =>
      validateThemeConfig({ ...baseValid(), fonts: 123 }),
    ).toThrow(/fonts must be a plain object/);
    expect(() =>
      validateThemeConfig({ ...baseValid(), radius: [] }),
    ).toThrow(/radius must be a plain object/);
  });

  it("rejects fonts with forbidden characters", () => {
    const raw = {
      ...baseValid(),
      fonts: { sans: "Inter; body{}", mono: "ok" },
    };
    expect(() => validateThemeConfig(raw)).toThrow(/forbidden characters/);
  });

  it("rejects empty font string", () => {
    const raw = { ...baseValid(), fonts: { sans: "  ", mono: "ok" } };
    expect(() => validateThemeConfig(raw)).toThrow(/non-empty/);
  });

  it("rejects over-long font string", () => {
    const raw = {
      ...baseValid(),
      fonts: { sans: "x".repeat(257), mono: "ok" },
    };
    expect(() => validateThemeConfig(raw)).toThrow(/≤ 256 characters/);
  });

  it("rejects malformed lengths", () => {
    expect(() =>
      validateThemeConfig({
        ...baseValid(),
        radius: { ...baseValid().radius, md: "9quant" },
      }),
    ).toThrow(/CSS length/);
    expect(() =>
      validateThemeConfig({
        ...baseValid(),
        radius: { ...baseValid().radius, md: 42 },
      }),
    ).toThrow(/must be a string/);
  });

  it("rejects bad effects", () => {
    expect(() =>
      validateThemeConfig({
        ...baseValid(),
        effects: { glow: "x{y}" },
      }),
    ).toThrow(/forbidden characters/);
    expect(() =>
      validateThemeConfig({
        ...baseValid(),
        effects: { glow: 3 },
      }),
    ).toThrow(/effects\.glow must be a string/);
    expect(() =>
      validateThemeConfig({
        ...baseValid(),
        effects: { glow: "x".repeat(257) },
      }),
    ).toThrow(/≤ 256/);
  });

  it("treats empty glow as empty string", () => {
    const v = validateThemeConfig({
      ...baseValid(),
      effects: { glow: "   " },
    });
    expect(v.effects?.glow).toBe("");
  });

  it("rejects non-string customCss", () => {
    expect(() =>
      validateThemeConfig({ ...baseValid(), customCss: 123 }),
    ).toThrow(/customCss must be a string/);
  });

  it("rejects customCss that blows the byte budget (multibyte input)", () => {
    const raw = { ...baseValid(), customCss: "ф".repeat(20_000) };
    expect(() => validateThemeConfig(raw)).toThrow(/exceeds/);
  });

  it("null customCss collapses to empty string", () => {
    const v = validateThemeConfig({ ...baseValid(), customCss: null });
    expect(v.customCss).toBe("");
  });
});

// ------------------------------------------------------------
// renderThemeCss
// ------------------------------------------------------------

describe("renderThemeCss", () => {
  it("emits :root block with every token and body selector", () => {
    const css = renderThemeCss(MINIMAL_HIGHTECH_THEME);
    expect(css).toMatch(/:root \{/);
    expect(css).toMatch(/--background: /);
    expect(css).toMatch(/--primary-hex: #D4AF37/);
    expect(css).toMatch(/--font-sans: /);
    expect(css).toMatch(/--radius: /);
    expect(css).toMatch(/body \{ font-family: var\(--font-sans\); \}/);
    expect(css).not.toMatch(/--font-display/);
  });

  it("includes display font when provided", () => {
    const css = renderThemeCss(ROYAL_GOLD_THEME);
    expect(css).toMatch(/--font-display: /);
  });

  it("inlines sanitised customCss at the tail", () => {
    const theme: ThemeConfig = {
      ...MINIMAL_HIGHTECH_THEME,
      customCss: ".foo{color:red}",
    };
    const css = renderThemeCss(theme);
    expect(css).toMatch(/--- Sovereign custom CSS ---/);
    expect(css.indexOf(".foo{color:red}")).toBeGreaterThan(css.indexOf(":root"));
  });

  it("omits effect vars when missing", () => {
    const theme: ThemeConfig = {
      ...MINIMAL_HIGHTECH_THEME,
      effects: {},
    };
    const css = renderThemeCss(theme);
    expect(css).not.toMatch(/--effect-blur/);
    expect(css).not.toMatch(/--effect-glow/);
  });
});

// ------------------------------------------------------------
// sanitiseCustomCss
// ------------------------------------------------------------

describe("sanitiseCustomCss", () => {
  it("strips </style>, <script>, HTML comments", () => {
    const out = sanitiseCustomCss(
      ".a{}</style>.b{}<script>x()</script>.c{}<!-- hi -->.d{}",
    );
    expect(out).not.toMatch(/<\/style>/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<!--/);
    expect(out).toMatch(/\.a\{\}/);
    expect(out).toMatch(/\.d\{\}/);
  });

  it("truncates to 16KB budget", () => {
    const out = sanitiseCustomCss("x".repeat(32_000));
    expect(out.length).toBe(16 * 1024);
  });
});
