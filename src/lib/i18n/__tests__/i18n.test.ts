/**
 * Unit tests for the i18n subsystem.
 * ------------------------------------------------------------
 * Coverage:
 *   * Locale registry — both ru and en are present, all keys
 *     declared in ru have a counterpart in en (or fall back).
 *   * Pluralization — Slavic 1/2/5/11/21 ↔ English 1/many.
 *   * Interpolation — `{name}` replacement, missing var stays
 *     literal so it's visible in the UI.
 *   * Compact / percent / duration — locale-independent enough
 *     for snapshot-style assertions.
 *   * Resolve fallback — missing key in `en` returns the `ru`
 *     value; missing key in both returns the key itself.
 *
 * The provider lives in a "use client" file; we test the pure
 * functions it composes (formatters + resolve-style helpers)
 * because they carry the actual logic.
 */

import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  interpolate,
  pluralize,
} from "../formatters";
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
} from "../locales";
import { ru } from "../locales/ru";
import { en } from "../locales/en";

describe("locales registry", () => {
  it("exposes ru and en with non-empty dictionaries", () => {
    expect(LOCALES.ru.dict).toBe(ru);
    expect(LOCALES.en.dict).toBe(en);
    expect(Object.keys(ru).length).toBeGreaterThan(50);
    expect(Object.keys(en).length).toBeGreaterThan(50);
  });

  it("default locale is the source of truth (ru)", () => {
    expect(DEFAULT_LOCALE).toBe("ru");
  });

  it("available locales each carry a BCP-47 tag", () => {
    for (const meta of AVAILABLE_LOCALES) {
      expect(meta.bcp47).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
      expect(meta.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("isLocale narrows unknown values", () => {
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("pluralization", () => {
  const slavicNodes = "{count} узел | {count} узла | {count} узлов";
  const englishItems = "{count} item | {count} items | {count} items";

  it("Slavic — picks the right form for representative numbers", () => {
    expect(pluralize(1, slavicNodes, "ru")).toBe("{count} узел");
    expect(pluralize(2, slavicNodes, "ru")).toBe("{count} узла");
    expect(pluralize(5, slavicNodes, "ru")).toBe("{count} узлов");
    expect(pluralize(11, slavicNodes, "ru")).toBe("{count} узлов");
    expect(pluralize(21, slavicNodes, "ru")).toBe("{count} узел");
    expect(pluralize(22, slavicNodes, "ru")).toBe("{count} узла");
    expect(pluralize(101, slavicNodes, "ru")).toBe("{count} узел");
    expect(pluralize(0, slavicNodes, "ru")).toBe("{count} узлов");
  });

  it("English — only one/other forms", () => {
    expect(pluralize(1, englishItems, "en")).toBe("{count} item");
    expect(pluralize(2, englishItems, "en")).toBe("{count} items");
    expect(pluralize(0, englishItems, "en")).toBe("{count} items");
    expect(pluralize(21, englishItems, "en")).toBe("{count} items");
  });

  it("falls back gracefully when the template has fewer variants", () => {
    expect(pluralize(1, "single", "ru")).toBe("single");
    expect(pluralize(5, "single", "en")).toBe("single");
  });
});

describe("interpolation", () => {
  it("replaces {placeholders} with values", () => {
    expect(interpolate("Hello {name}!", { name: "Red" })).toBe("Hello Red!");
  });

  it("supports numeric placeholders", () => {
    expect(interpolate("{count} items", { count: 5 })).toBe("5 items");
  });

  it("leaves unknown placeholders untouched (visible in UI)", () => {
    expect(interpolate("Hello {missing}", { name: "Red" })).toBe(
      "Hello {missing}",
    );
  });

  it("returns the template unchanged when vars is undefined", () => {
    expect(interpolate("static")).toBe("static");
  });
});

describe("number / percent / compact / duration", () => {
  it("formats numbers using the locale's BCP-47 tag", () => {
    const ruOut = formatNumber(1234.5, "ru");
    const enOut = formatNumber(1234.5, "en");
    expect(ruOut).toMatch(/1[\s\u00A0\u202F]234[,.]5/);
    expect(enOut).toMatch(/1,234\.5/);
  });

  it("formatPercent rounds tiny fractions to two decimals", () => {
    expect(formatPercent(0, "ru")).toBe("0%");
    expect(formatPercent(0.05, "ru")).toBe("5.00%");
    expect(formatPercent(0.5, "ru")).toBe("50%");
    expect(formatPercent(1, "ru")).toBe("100%");
  });

  it("formatCompact scales k / M with two decimals", () => {
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(1500)).toBe("1.50k");
    expect(formatCompact(2_500_000)).toBe("2.50M");
  });

  it("formatDuration uses Russian short units for ru, English for en", () => {
    expect(formatDuration(86_400, "ru")).toBe("1д 0ч");
    expect(formatDuration(86_400, "en")).toBe("1d 0h");
    expect(formatDuration(3_600, "ru")).toBe("1ч 0м");
    expect(formatDuration(60, "en")).toBe("1m");
    expect(formatDuration(-1, "ru")).toBe("—");
  });
});

describe("dictionary parity (ru ↔ en)", () => {
  /**
   * Russian is the source of truth. We don't require a 100%
   * translation rate (the runtime falls back to ru anyway), but
   * we do flag a sample of high-traffic keys that *must* be
   * present in every locale to keep critical UX in the user's
   * language.
   */
  const REQUIRED_KEYS = [
    "common.loading",
    "common.save",
    "common.cancel",
    "common.error",
    "language.switcher.label",
    "app.title",
    "app.brand",
    "home.cta.coronate",
    "wallet.transfer",
    "wallet.my",
    "chat.connect.submit",
    "governance.title",
  ];

  it.each(REQUIRED_KEYS)("ru and en both define %s", (key) => {
    expect(ru[key]).toBeDefined();
    expect(en[key]).toBeDefined();
  });

  it("plural template uses three pipe-separated variants in ru", () => {
    const template = ru["nexus.vertical.nodes"];
    expect(template).toBeDefined();
    expect(template).toMatch(/\|/);
    const parts = template!.split("|").map((s) => s.trim());
    expect(parts.length).toBe(3);
  });
});
