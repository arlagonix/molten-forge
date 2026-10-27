import { describe, expect, it } from "vitest";
import { shouldNotifyForSettledRun } from "./response-notifications";

const baseline = { enabled: true, started: true, interrupted: false, providerAborted: false, focused: false };

describe("background completion notifications", () => {
  it("notifies for an enabled completed background run", () => {
    expect(shouldNotifyForSettledRun(baseline)).toBe(true);
  });
  for (const [name, field] of [
    ["disabled", "enabled"], ["no run", "started"],
  ] as const) {
    it(`does not notify for ${name}`, () => {
      expect(shouldNotifyForSettledRun({ ...baseline, [field]: false })).toBe(false);
    });
  }
  for (const field of ["focused", "interrupted", "providerAborted"] as const) {
    it(`does not notify when ${field}`, () => {
      expect(shouldNotifyForSettledRun({ ...baseline, [field]: true })).toBe(false);
    });
  }
});
