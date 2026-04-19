import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { rejectIfCrossSiteMutation } from "../same-origin-mutation";

function post(url: string, headers: Record<string, string>) {
  return new NextRequest(url, { method: "POST", headers });
}

describe("rejectIfCrossSiteMutation", () => {
  const base = "http://localhost:3000/api/register";

  it("allows matching Origin", () => {
    const req = post(base, { origin: "http://localhost:3000" });
    expect(rejectIfCrossSiteMutation(req)).toBeNull();
  });

  it("allows Bearer and ignores wrong Origin", () => {
    const req = post(base, {
      origin: "https://evil.example",
      authorization: "Bearer secret-token",
    });
    expect(rejectIfCrossSiteMutation(req)).toBeNull();
  });

  it("rejects mismatched Origin", () => {
    const req = post(base, { origin: "https://evil.example" });
    const res = rejectIfCrossSiteMutation(req);
    expect(res?.status).toBe(403);
  });

  it("allows Referer when Origin is absent", () => {
    const req = post(base, { referer: "http://localhost:3000/page" });
    expect(rejectIfCrossSiteMutation(req)).toBeNull();
  });

  it("rejects cross-site Sec-Fetch-Site", () => {
    const req = post(base, { "sec-fetch-site": "cross-site" });
    expect(rejectIfCrossSiteMutation(req)?.status).toBe(403);
  });

  it("allows same-origin Sec-Fetch-Site without Origin", () => {
    const req = post(base, { "sec-fetch-site": "same-origin" });
    expect(rejectIfCrossSiteMutation(req)).toBeNull();
  });
});
