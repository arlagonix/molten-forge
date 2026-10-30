import { describe, expect, it } from "vitest";
import { isExternalHttpUrl } from "./external-url";

describe("external URL handling", () => {
  it("accepts normal HTTP(S) links", () => {
    expect(isExternalHttpUrl("https://example.com/path?q=1#hash")).toBe(true);
    expect(isExternalHttpUrl("http://localhost:3000/docs")).toBe(true);
  });

  it("rejects relative, non-web, malformed, and control-character URLs", () => {
    expect(isExternalHttpUrl("/docs/readme")).toBe(false);
    expect(isExternalHttpUrl("mailto:test@example.com")).toBe(false);
    expect(isExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalHttpUrl("https://example.com\nfoo")).toBe(false);
    expect(isExternalHttpUrl("not a url")).toBe(false);
  });
});
