import { describe, expect, it } from "vitest";
import backgroundMountainsDark from "../assets/background-mountains-dark.jpg";
import backgroundMountainsLight from "../assets/background-mountains-light.jpg";

describe("bundled appearance assets", () => {
  it("keeps both default Molten Forge background images importable by Vite", () => {
    expect(backgroundMountainsDark).toMatch(/background-mountains-dark/);
    expect(backgroundMountainsLight).toMatch(/background-mountains-light/);
  });
});
