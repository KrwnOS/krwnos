import { describe, expect, it } from "vitest";
import { parseS3Uri } from "../backup-s3-storage";

describe("parseS3Uri", () => {
  it("parses bucket and key", () => {
    expect(parseS3Uri("s3://my-bucket/krwn-backups/krwn-state-1.json")).toEqual({
      bucket: "my-bucket",
      key: "krwn-backups/krwn-state-1.json",
    });
  });

  it("rejects invalid uris", () => {
    expect(() => parseS3Uri("https://example.com/x")).toThrow(/invalid s3/);
    expect(() => parseS3Uri("data:application/json,{}")).toThrow(/invalid s3/);
  });
});
