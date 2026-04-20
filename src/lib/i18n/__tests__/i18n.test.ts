/**
 * Unit tests for the i18n subsystem (registry + ICU path + formatters).
 */

import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  interpolate,
} from "../formatters";
import { formatIcu } from "../icu";
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
} from "../locales";
import { ru } from "../locales/ru";
import { en } from "../locales/en";

describe("locales registry", () => {
  it("exposes en and ru with non-empty dictionaries", () => {
    expect(LOCALES.en.dict).toBe(en);
    expect(LOCALES.ru.dict).toBe(ru);
    expect(Object.keys(ru).length).toBeGreaterThan(50);
    expect(Object.keys(en).length).toBeGreaterThan(50);
  });

  it("default locale is English (fallback chain)", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("available locales each carry a BCP-47 tag", () => {
    for (const meta of AVAILABLE_LOCALES) {
      expect(meta.bcp47).toMatch(/^[a-z]{2}(-[A-Za-z0-9-]+)?$/);
      expect(meta.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("isLocale narrows unknown values", () => {
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("tr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("ICU via formatIcu (representative templates)", () => {
  const template =
    "{count, plural, one {# item} other {# items}}";

  it("English plural", () => {
    expect(formatIcu("en", template, { count: 1 })).toBe("1 item");
    expect(formatIcu("en", template, { count: 0 })).toBe("0 items");
  });
});

describe("interpolation (legacy helper, still used by some formatters)", () => {
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

  it("formatDuration uses Russian short units for ru, English for others", () => {
    expect(formatDuration(86_400, "ru")).toBe("1д 0ч");
    expect(formatDuration(86_400, "en")).toBe("1d 0h");
    expect(formatDuration(86_400, "es")).toBe("1d 0h");
    expect(formatDuration(3_600, "ru")).toBe("1ч 0м");
    expect(formatDuration(60, "en")).toBe("1m");
    expect(formatDuration(-1, "ru")).toBe("—");
  });
});

describe("dictionary parity (critical keys)", () => {
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
    "nexus.vertical.nodes",
    "chat.tray.items",
  ];

  it.each(REQUIRED_KEYS)("en and ru both define %s", (key) => {
    expect(en[key]).toBeDefined();
    expect(ru[key]).toBeDefined();
  });

  it("nexus.vertical.nodes uses ICU plural", () => {
    const template = en["nexus.vertical.nodes"];
    expect(template).toBeDefined();
    expect(template).toContain("plural");
  });
});
