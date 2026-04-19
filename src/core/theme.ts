/**
 * Theme Engine (Движок Тем).
 * ------------------------------------------------------------
 * Чистое ядро визуального суверенитета. Здесь живут:
 *
 *   1. Типы `ThemeConfig` / `ThemeColors` / `ThemeFonts` / `ThemeRadius`.
 *   2. Галерея дефолтных пресетов (Minimalist High-Tech, Terminal,
 *      Glassmorphism, Royal Gold, Cyberpunk). Пресеты — это не
 *      статичные конфиги, а «отправная точка»: Суверен может
 *      взять любой из них и переопределить отдельные токены.
 *   3. Нормализация и валидация произвольного JSON-блоба из БД
 *      (поле `State.themeConfig`) — сервисы и API-роуты полагаются
 *      на то, что `normaliseThemeConfig` никогда не бросает.
 *   4. Генерация CSS — `renderThemeCss(config)` возвращает строку,
 *      которую ThemeProvider (клиент или сервер) вставляет в
 *      `<style>`, чтобы перезаписать `:root`.
 *
 * Почему hex-цвета, а не hsl-тройки: так их проще редактировать в
 * UI (<input type="color">) и хранить в БД. Внутри CSS мы всё равно
 * вычисляем HSL-тройки для совместимости с текущим Tailwind,
 * который использует шаблон `hsl(var(--background) / <alpha-value>)`.
 *
 * Модуль НЕ трогает DOM и НЕ импортирует React — чистые функции,
 * которые удобно тестировать и рендерить на сервере.
 */

// ============================================================
// 1. Types
// ============================================================

export type ThemePresetId =
  | "minimal-hightech"
  | "terminal"
  | "glass"
  | "royal-gold"
  | "cyberpunk"
  | "custom";

export interface ThemeColors {
  /** Фон страницы. Hex (#RRGGBB or #RGB). */
  background: string;
  /** Основной текст на фоне. */
  foreground: string;
  /**
   * Surface — основная поверхность: карточки, модалки, панели. В
   * дефолтной палитре Minimalist High-Tech — Slate Gray (#1E1E1E).
   * Экспонируется в CSS как `--card` и одноимённая hex-переменная,
   * чтобы Tailwind мог использовать `bg-card`.
   */
  card: string;
  /** Тонкий дополнительный фон — полосы, кнопки "ghost", placeholder'ы. */
  muted: string;
  /** Границы, разделители. */
  border: string;
  /** Акцент — «фирменный» цвет, подсветки, ссылки. */
  accent: string;
  /** Primary — главная кнопка / CTA (обычно равен accent). */
  primary: string;
  /** Деструктив — ошибки, удаление. */
  destructive: string;
}

export interface ThemeFonts {
  /** Тело интерфейса. */
  sans: string;
  /** Моноширинный шрифт для кода / адресов / чисел. */
  mono: string;
  /** Опциональный «парадный» шрифт для заголовков. */
  display?: string | null;
}

export interface ThemeRadius {
  /** Малый радиус — чипы, input'ы. В rem или px. */
  sm: string;
  /** Средний радиус — кнопки, карточки. */
  md: string;
  /** Крупный — модалки, галерейные карточки. */
  lg: string;
}

export interface ThemeEffects {
  /** Радиус размытия для glassmorphism-поверхностей. */
  blur?: string;
  /** Свечение акцентных кнопок (box-shadow). */
  glow?: string;
}

export interface ThemeConfig {
  preset: ThemePresetId;
  colors: ThemeColors;
  fonts: ThemeFonts;
  radius: ThemeRadius;
  effects?: ThemeEffects;
  /**
   * Сырой CSS, который ThemeProvider вставит после сгенерированных
   * токенов. Нужен продвинутым Суверенам — они могут полностью
   * перекроить UI своих модулей. Мы чуть-чуть обрезаем вредные
   * последовательности (<\/style>, <script>) в `sanitiseCustomCss`.
   */
  customCss?: string;
}

// ============================================================
// 2. Presets
// ============================================================

/**
 * Канон — «эталонный» интерфейс, который выдают свежие инстансы.
 * Если Суверен ни разу не менял тему, вся экосистема живёт на этих
 * значениях, и мы можем гарантировать одинаковый look & feel
 * между продакшеном, локальной разработкой и тестами.
 */
export const MINIMAL_HIGHTECH_THEME: ThemeConfig = {
  preset: "minimal-hightech",
  colors: {
    // Anthracite — глубокий чёрный, бережёт глаза и задаёт премиум-тон.
    background: "#0A0A0A",
    // White/Silver — читаемый текст на Anthracite.
    foreground: "#E2E2E2",
    // Slate Gray — цвет карточек и панелей.
    card: "#1E1E1E",
    // Чуть темнее card — тонкий подслой для полос и placeholder'ов.
    muted: "#141414",
    border: "#2A2A2A",
    // Gold — акценты, кнопки, активные роли, «Корона».
    accent: "#D4AF37",
    primary: "#D4AF37",
    destructive: "#E5484D",
  },
  fonts: {
    sans: "Inter, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  radius: { sm: "0.25rem", md: "0.5rem", lg: "0.75rem" },
  effects: {
    blur: "12px",
    glow: "0 0 24px -6px rgba(212,175,55,0.45)",
  },
  customCss: "",
};

/** Terminal / BBS — «зелёный экран», матричный CRT. */
export const TERMINAL_THEME: ThemeConfig = {
  preset: "terminal",
  colors: {
    background: "#050807",
    foreground: "#B8FFB6",
    card: "#0B120F",
    muted: "#07100C",
    border: "#0F3A2C",
    accent: "#25F4A1",
    primary: "#25F4A1",
    destructive: "#FF6B4A",
  },
  fonts: {
    sans: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  radius: { sm: "0rem", md: "0rem", lg: "0rem" },
  effects: {
    blur: "0px",
    glow: "0 0 18px -4px rgba(37,244,161,0.55)",
  },
  customCss: "",
};

/** Glassmorphism — светлая полупрозрачная эстетика в духе macOS. */
export const GLASS_THEME: ThemeConfig = {
  preset: "glass",
  colors: {
    background: "#E9ECF2",
    foreground: "#14131A",
    card: "#FFFFFF",
    muted: "#F6F7FB",
    border: "#C9CCD4",
    accent: "#6366F1",
    primary: "#6366F1",
    destructive: "#E11D48",
  },
  fonts: {
    sans:
      "'SF Pro Text', 'Inter', system-ui, -apple-system, sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  radius: { sm: "0.625rem", md: "1rem", lg: "1.5rem" },
  effects: {
    blur: "24px",
    glow: "0 8px 32px -8px rgba(99,102,241,0.35)",
  },
  customCss: "",
};

/** Royal Gold — «корона»: тёмно-пурпур + золотой глиф. */
export const ROYAL_GOLD_THEME: ThemeConfig = {
  preset: "royal-gold",
  colors: {
    background: "#140A1F",
    foreground: "#F5EBCC",
    card: "#281438",
    muted: "#1F1128",
    border: "#3A1F52",
    accent: "#F2C14E",
    primary: "#F2C14E",
    destructive: "#C2413C",
  },
  fonts: {
    sans: "'Cormorant Garamond', 'Inter', serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    display: "'Cinzel', 'Cormorant Garamond', serif",
  },
  radius: { sm: "0.25rem", md: "0.375rem", lg: "0.5rem" },
  effects: {
    blur: "16px",
    glow: "0 0 32px -4px rgba(242,193,78,0.55)",
  },
  customCss: "",
};

/** Cyberpunk — неон для кланов киберспорта. */
export const CYBERPUNK_THEME: ThemeConfig = {
  preset: "cyberpunk",
  colors: {
    background: "#05020F",
    foreground: "#F0F6FF",
    card: "#120826",
    muted: "#0D0720",
    border: "#2A103F",
    accent: "#FF2E9A",
    primary: "#00E5FF",
    destructive: "#FF5073",
  },
  fonts: {
    sans: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    display: "'Orbitron', 'Space Grotesk', sans-serif",
  },
  radius: { sm: "0.125rem", md: "0.25rem", lg: "0.5rem" },
  effects: {
    blur: "10px",
    glow:
      "0 0 32px -4px rgba(255,46,154,0.8), 0 0 18px -6px rgba(0,229,255,0.6)",
  },
  customCss: "",
};

export const THEME_PRESETS: Record<
  Exclude<ThemePresetId, "custom">,
  ThemeConfig
> = {
  "minimal-hightech": MINIMAL_HIGHTECH_THEME,
  terminal: TERMINAL_THEME,
  glass: GLASS_THEME,
  "royal-gold": ROYAL_GOLD_THEME,
  cyberpunk: CYBERPUNK_THEME,
};

/** Алиас — то, что лежит в БД по умолчанию. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = MINIMAL_HIGHTECH_THEME;

/** Список пресетов для галерей UI — сохраняет порядок. */
export const THEME_PRESET_ORDER: ReadonlyArray<
  Exclude<ThemePresetId, "custom">
> = [
  "minimal-hightech",
  "terminal",
  "glass",
  "royal-gold",
  "cyberpunk",
];

// ============================================================
// 3. Validation / normalisation
// ============================================================

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH_RE = /^-?\d+(?:\.\d+)?(?:rem|em|px|%)$/;
const MAX_CUSTOM_CSS_BYTES = 16 * 1024;

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeValidationError";
  }
}

/**
 * Нормализует сырой JSON из БД до типизированного `ThemeConfig`.
 * Никогда не бросает — любое отклонение от формы трактуется как
 * «используй дефолт для этого поля». Используется SSR'ом, где
 * гарантия «страница всегда рендерится» важнее строгости.
 */
export function normaliseThemeConfig(raw: unknown): ThemeConfig {
  if (!isPlainObject(raw)) return cloneTheme(DEFAULT_THEME_CONFIG);

  const preset = isPresetId(raw.preset) ? raw.preset : "custom";
  const baseline: ThemeConfig =
    preset !== "custom" && preset in THEME_PRESETS
      ? THEME_PRESETS[preset as Exclude<ThemePresetId, "custom">]
      : DEFAULT_THEME_CONFIG;

  const colorsRaw = isPlainObject(raw.colors) ? raw.colors : {};
  const fontsRaw = isPlainObject(raw.fonts) ? raw.fonts : {};
  const radiusRaw = isPlainObject(raw.radius) ? raw.radius : {};
  const effectsRaw = isPlainObject(raw.effects) ? raw.effects : {};

  const colors: ThemeColors = {
    background: pickHex(colorsRaw.background, baseline.colors.background),
    foreground: pickHex(colorsRaw.foreground, baseline.colors.foreground),
    // `card` был добавлен позже: если в БД лежит старый JSON без него,
    // аккуратно наследуем значение из `muted`, а не падаем на дефолт.
    card: pickHex(
      colorsRaw.card ?? colorsRaw.muted,
      baseline.colors.card,
    ),
    muted: pickHex(colorsRaw.muted, baseline.colors.muted),
    border: pickHex(colorsRaw.border, baseline.colors.border),
    accent: pickHex(colorsRaw.accent, baseline.colors.accent),
    primary: pickHex(colorsRaw.primary, baseline.colors.primary),
    destructive: pickHex(
      colorsRaw.destructive,
      baseline.colors.destructive,
    ),
  };

  const fonts: ThemeFonts = {
    sans: pickFont(fontsRaw.sans, baseline.fonts.sans),
    mono: pickFont(fontsRaw.mono, baseline.fonts.mono),
    display: pickFontOptional(fontsRaw.display, baseline.fonts.display ?? null),
  };

  const radius: ThemeRadius = {
    sm: pickLength(radiusRaw.sm, baseline.radius.sm),
    md: pickLength(radiusRaw.md, baseline.radius.md),
    lg: pickLength(radiusRaw.lg, baseline.radius.lg),
  };

  const effects: ThemeEffects = {
    blur: pickLength(
      effectsRaw.blur,
      baseline.effects?.blur ?? "0px",
    ),
    glow: typeof effectsRaw.glow === "string"
      ? truncate(effectsRaw.glow, 256)
      : baseline.effects?.glow,
  };

  const customCss =
    typeof raw.customCss === "string"
      ? sanitiseCustomCss(raw.customCss)
      : "";

  return { preset, colors, fonts, radius, effects, customCss };
}

/**
 * Строгая валидация — бросает `ThemeValidationError` при любом
 * некорректном поле. Используется API-роутом перед записью в БД;
 * нормализация — для чтения.
 */
export function validateThemeConfig(raw: unknown): ThemeConfig {
  if (!isPlainObject(raw)) {
    throw new ThemeValidationError("themeConfig must be a plain object.");
  }

  const preset = raw.preset;
  if (!isPresetId(preset)) {
    throw new ThemeValidationError(
      `preset must be one of: ${[
        ...THEME_PRESET_ORDER,
        "custom",
      ].join(", ")}.`,
    );
  }

  const colors = raw.colors;
  if (!isPlainObject(colors)) {
    throw new ThemeValidationError("colors must be a plain object.");
  }
  const validatedColors: ThemeColors = {
    background: requireHex(colors.background, "colors.background"),
    foreground: requireHex(colors.foreground, "colors.foreground"),
    // В строгой валидации `card` тоже опционально наследуется от
    // `muted` — это смягчает апгрейд старых клиентов, но сохраняет
    // контракт «получили hex — сохранили hex».
    card: requireHex(colors.card ?? colors.muted, "colors.card"),
    muted: requireHex(colors.muted, "colors.muted"),
    border: requireHex(colors.border, "colors.border"),
    accent: requireHex(colors.accent, "colors.accent"),
    primary: requireHex(colors.primary, "colors.primary"),
    destructive: requireHex(colors.destructive, "colors.destructive"),
  };

  const fonts = raw.fonts;
  if (!isPlainObject(fonts)) {
    throw new ThemeValidationError("fonts must be a plain object.");
  }
  const validatedFonts: ThemeFonts = {
    sans: requireFont(fonts.sans, "fonts.sans"),
    mono: requireFont(fonts.mono, "fonts.mono"),
    display: fonts.display == null
      ? null
      : requireFont(fonts.display, "fonts.display"),
  };

  const radius = raw.radius;
  if (!isPlainObject(radius)) {
    throw new ThemeValidationError("radius must be a plain object.");
  }
  const validatedRadius: ThemeRadius = {
    sm: requireLength(radius.sm, "radius.sm"),
    md: requireLength(radius.md, "radius.md"),
    lg: requireLength(radius.lg, "radius.lg"),
  };

  const effects = isPlainObject(raw.effects) ? raw.effects : {};
  const validatedEffects: ThemeEffects = {
    blur: effects.blur === undefined
      ? undefined
      : requireLength(effects.blur, "effects.blur"),
    glow: effects.glow === undefined
      ? undefined
      : requireGlow(effects.glow),
  };

  const customCss =
    raw.customCss == null ? "" : requireCustomCss(raw.customCss);

  return {
    preset,
    colors: validatedColors,
    fonts: validatedFonts,
    radius: validatedRadius,
    effects: validatedEffects,
    customCss,
  };
}

// ============================================================
// 4. CSS rendering
// ============================================================

/**
 * Возвращает CSS-текст, который нужно вставить в `<style>` в
 * `<head>`. Содержит:
 *   * Совместимые HSL-тройки (для текущего Tailwind — `hsl(var(--bg)
 *     / <alpha-value>)`).
 *   * Прямые hex-варианты (--background-hex, --primary-hex, …) —
 *     удобно для свечений, градиентов, CSS-анимаций.
 *   * Шрифты, радиусы, эффекты.
 *   * `customCss` Суверена — в самом конце, чтобы он мог
 *     переопределить всё остальное.
 */
export function renderThemeCss(config: ThemeConfig): string {
  const hsl = {
    background: hexToHslTriple(config.colors.background),
    foreground: hexToHslTriple(config.colors.foreground),
    card: hexToHslTriple(config.colors.card),
    muted: hexToHslTriple(config.colors.muted),
    border: hexToHslTriple(config.colors.border),
    accent: hexToHslTriple(config.colors.accent),
    primary: hexToHslTriple(config.colors.primary),
    destructive: hexToHslTriple(config.colors.destructive),
  };

  const lines: string[] = [];
  lines.push(":root {");
  lines.push(`  --background: ${hsl.background};`);
  lines.push(`  --foreground: ${hsl.foreground};`);
  lines.push(`  --card: ${hsl.card};`);
  lines.push(`  --muted: ${hsl.muted};`);
  lines.push(`  --border: ${hsl.border};`);
  lines.push(`  --accent: ${hsl.accent};`);
  lines.push(`  --primary: ${hsl.primary};`);
  lines.push(`  --destructive: ${hsl.destructive};`);

  lines.push(`  --background-hex: ${config.colors.background};`);
  lines.push(`  --foreground-hex: ${config.colors.foreground};`);
  lines.push(`  --card-hex: ${config.colors.card};`);
  lines.push(`  --muted-hex: ${config.colors.muted};`);
  lines.push(`  --border-hex: ${config.colors.border};`);
  lines.push(`  --accent-hex: ${config.colors.accent};`);
  lines.push(`  --primary-hex: ${config.colors.primary};`);
  lines.push(`  --destructive-hex: ${config.colors.destructive};`);

  lines.push(`  --font-sans: ${config.fonts.sans};`);
  lines.push(`  --font-mono: ${config.fonts.mono};`);
  if (config.fonts.display) {
    lines.push(`  --font-display: ${config.fonts.display};`);
  }

  lines.push(`  --radius-sm: ${config.radius.sm};`);
  lines.push(`  --radius: ${config.radius.md};`);
  lines.push(`  --radius-lg: ${config.radius.lg};`);

  if (config.effects?.blur) {
    lines.push(`  --effect-blur: ${config.effects.blur};`);
  }
  if (config.effects?.glow) {
    lines.push(`  --effect-glow: ${config.effects.glow};`);
  }

  lines.push("}");

  // Пресет cyberpunk заслуживает немного неоновой магии по
  // умолчанию — мы подсвечиваем focus-ring, если тема включена.
  lines.push("body { font-family: var(--font-sans); }");

  const customCss = config.customCss?.trim();
  if (customCss) {
    lines.push("/* --- Sovereign custom CSS --- */");
    lines.push(customCss);
  }

  return lines.join("\n");
}

// ============================================================
// 5. Helpers
// ============================================================

export function cloneTheme(theme: ThemeConfig): ThemeConfig {
  return {
    preset: theme.preset,
    colors: { ...theme.colors },
    fonts: { ...theme.fonts },
    radius: { ...theme.radius },
    effects: theme.effects ? { ...theme.effects } : {},
    customCss: theme.customCss ?? "",
  };
}

export function getPreset(id: ThemePresetId): ThemeConfig {
  if (id === "custom") return cloneTheme(DEFAULT_THEME_CONFIG);
  return cloneTheme(THEME_PRESETS[id]);
}

export function isPresetId(value: unknown): value is ThemePresetId {
  if (typeof value !== "string") return false;
  return (
    value === "custom" ||
    (THEME_PRESET_ORDER as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Превращает `#RRGGBB` или `#RGB` в HSL-тройку `"H S% L%"`,
 * пригодную для `hsl(var(--x) / <alpha-value>)` (Tailwind).
 * Возвращает `0 0% 0%`, если строка невалидна — тоже безопасный
 * дефолт.
 */
export function hexToHslTriple(hex: string): string {
  const normalised = normaliseHex(hex);
  if (!normalised) return "0 0% 0%";
  const r = parseInt(normalised.slice(1, 3), 16) / 255;
  const g = parseInt(normalised.slice(3, 5), 16) / 255;
  const b = parseInt(normalised.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      case b:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
  }

  const hh = Math.round(h);
  const ss = Math.round(s * 100);
  const ll = Math.round(l * 100);
  return `${hh} ${ss}% ${ll}%`;
}

function normaliseHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  if (trimmed.length === 4) {
    const [, a, b, c] = trimmed;
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

function pickHex(input: unknown, fallback: string): string {
  const normal = normaliseHex(input);
  return normal ?? fallback;
}

function requireHex(input: unknown, field: string): string {
  const normal = normaliseHex(input);
  if (!normal) {
    throw new ThemeValidationError(
      `${field} must be a hex color like #D4AF37 or #D27.`,
    );
  }
  return normal;
}

function pickFont(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const cleaned = truncate(input.trim(), 256);
  if (!cleaned) return fallback;
  if (containsUnsafeFontChars(cleaned)) return fallback;
  return cleaned;
}

function pickFontOptional(
  input: unknown,
  fallback: string | null,
): string | null {
  if (input === null) return null;
  if (typeof input !== "string") return fallback;
  const cleaned = truncate(input.trim(), 256);
  if (!cleaned) return null;
  if (containsUnsafeFontChars(cleaned)) return fallback;
  return cleaned;
}

function requireFont(input: unknown, field: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ThemeValidationError(`${field} must be a non-empty string.`);
  }
  const trimmed = input.trim();
  if (trimmed.length > 256) {
    throw new ThemeValidationError(`${field} must be ≤ 256 characters.`);
  }
  if (containsUnsafeFontChars(trimmed)) {
    throw new ThemeValidationError(
      `${field} contains forbidden characters (";", "{", "}", "<").`,
    );
  }
  return trimmed;
}

function pickLength(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const trimmed = input.trim();
  if (!LENGTH_RE.test(trimmed)) return fallback;
  return trimmed;
}

function requireLength(input: unknown, field: string): string {
  if (typeof input !== "string") {
    throw new ThemeValidationError(`${field} must be a string.`);
  }
  const trimmed = input.trim();
  if (!LENGTH_RE.test(trimmed)) {
    throw new ThemeValidationError(
      `${field} must be a CSS length like "0.5rem", "12px" or "100%".`,
    );
  }
  return trimmed;
}

function requireGlow(input: unknown): string {
  if (typeof input !== "string") {
    throw new ThemeValidationError("effects.glow must be a string.");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > 256) {
    throw new ThemeValidationError(
      "effects.glow must be ≤ 256 characters.",
    );
  }
  if (/[{}<>;@]/.test(trimmed)) {
    throw new ThemeValidationError(
      "effects.glow contains forbidden characters.",
    );
  }
  return trimmed;
}

function requireCustomCss(input: unknown): string {
  if (typeof input !== "string") {
    throw new ThemeValidationError("customCss must be a string.");
  }
  const sanitised = sanitiseCustomCss(input);
  if (Buffer.byteLength(sanitised, "utf8") > MAX_CUSTOM_CSS_BYTES) {
    throw new ThemeValidationError(
      `customCss exceeds ${MAX_CUSTOM_CSS_BYTES} bytes.`,
    );
  }
  return sanitised;
}

/**
 * Минимальная очистка произвольного CSS. Мы не пытаемся полностью
 * защититься (CSS не исполнимый в изоляции), но срезаем самые
 * грубые попытки вырваться из `<style>`.
 */
export function sanitiseCustomCss(raw: string): string {
  return raw
    .replace(/<\/style\s*>/gi, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .slice(0, MAX_CUSTOM_CSS_BYTES);
}

function containsUnsafeFontChars(value: string): boolean {
  return /[;{}<]/.test(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}
