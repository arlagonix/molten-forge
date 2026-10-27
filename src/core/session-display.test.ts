import { describe, expect, it } from "vitest";
import { formatSessionDate } from "./session-display";

describe("session sidebar date formatting", () => {
  it("uses an explicit English locale for non-today dates", () => {
    const now = new Date(2026, 8, 28, 12, 0);
    expect(formatSessionDate(new Date(2026, 8, 25, 9, 30).getTime(), now)).toBe("25 Sep");
  });

  it("uses a compact 24-hour English time for today's sessions", () => {
    const now = new Date(2026, 8, 28, 18, 0);
    expect(formatSessionDate(new Date(2026, 8, 28, 9, 5).getTime(), now)).toBe("09:05");
  });

  it("returns an empty label for missing or invalid timestamps", () => {
    expect(formatSessionDate(undefined)).toBe("");
    expect(formatSessionDate("not-a-date")).toBe("");
  });
});
