import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const startup = readFileSync(new URL("../components/pi-startup-welcome.tsx", import.meta.url), "utf8");

describe("empty chat layout regression", () => {
  it("marks the empty transcript as a dedicated non-scrolling layout", () => {
    expect(app).toMatch(/const isEmpty = items\.length === 0 && !historyLoading;/);
    expect(app).toMatch(/const isHistoryLoading = items\.length === 0 && historyLoading;/);
    expect(app).toMatch(/transcript-empty/);
    expect(styles).toMatch(/\.transcript\.transcript-empty\s*\{[\s\S]*?overflow-y:\s*hidden;/);
  });

  it("uses Pi's compact startup copy instead of the old welcome card", () => {
    expect(app).toContain("<PiStartupWelcome piVersion={piVersion} commands={commands} />");
    expect(app).not.toContain("Start a conversation");
    expect(startup).toContain("escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more");
    expect(startup).toContain("Press ctrl+o to show full startup help and loaded resources.");
    expect(startup).toContain("Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.");
  });

  it("keeps empty and history-loading transcript geometry on the same stable scrollbar gutter", () => {
    expect(styles).toMatch(/\.transcript\.transcript-empty[\s\S]{0,160}scrollbar-gutter:\s*stable;/);
    expect(styles).toMatch(/\.transcript\.transcript-history-loading[\s\S]{0,160}scrollbar-gutter:\s*stable;/);
  });

  it("does not flash the empty welcome state while another session history is loading", () => {
    expect(app).toMatch(/isEmpty \? \([\s\S]*?isHistoryLoading \? \([\s\S]*?transcript-history-placeholder/);
    expect(styles).toMatch(/\.transcript\.transcript-history-loading\s*\{[\s\S]*?overflow-y:\s*hidden;/);
  });

  it("resets a reused transcript scroll element after the empty state commits", () => {
    expect(app).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?if \(!isEmpty\) return;[\s\S]*?transcript\.scrollTop = 0;[\s\S]*?requestAnimationFrame\(landAtTop\)/);
    expect(app).toMatch(/remainingFrames = 2/);
  });

  it("remounts the transcript scroll element when the active session changes", () => {
    expect(app).toContain('key={activeSessionPath ?? "__new-session__"}');
  });
});
