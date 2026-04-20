import { describe, expect, it } from "vitest";
import {
  isSovereignOnboardingComplete,
  markSovereignOnboardingComplete,
  SOVEREIGN_ONBOARDING_EXTRAS_KEY,
} from "../sovereign-onboarding";

describe("sovereign-onboarding extras", () => {
  it("marks and reads completion per user without clobbering other extras", () => {
    const u1 = "user_a";
    const u2 = "user_b";
    let extras = markSovereignOnboardingComplete({ foo: 1 } as Record<string, unknown>, u1);
    expect(extras.foo).toBe(1);
    expect(isSovereignOnboardingComplete(extras, u1)).toBe(true);
    expect(isSovereignOnboardingComplete(extras, u2)).toBe(false);

    extras = markSovereignOnboardingComplete(extras, u2);
    expect(isSovereignOnboardingComplete(extras, u1)).toBe(true);
    expect(isSovereignOnboardingComplete(extras, u2)).toBe(true);
    const map = extras[SOVEREIGN_ONBOARDING_EXTRAS_KEY] as Record<string, string>;
    expect(typeof map[u1]).toBe("string");
    expect(typeof map[u2]).toBe("string");
  });

  it("returns false for malformed extras", () => {
    expect(isSovereignOnboardingComplete(undefined, "x")).toBe(false);
    expect(
      isSovereignOnboardingComplete(
        { [SOVEREIGN_ONBOARDING_EXTRAS_KEY]: [] } as unknown as Record<
          string,
          unknown
        >,
        "x",
      ),
    ).toBe(false);
  });
});
