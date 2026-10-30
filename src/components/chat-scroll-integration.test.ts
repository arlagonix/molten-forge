import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("chat scroll integration contracts", () => {
  it("restores the old Molten Forge moving-bottom rAF lerp", () => {
    expect(appSource).toContain("nextStickyScrollTop(transcript.scrollTop, target)");
    expect(appSource).toContain("stickyScrollTarget({");
    expect(appSource).toMatch(/stickyScrollFrameRef\.current = window\.requestAnimationFrame\(runFrame\)/);
    expect(appSource).not.toContain("AUTO_FOLLOW_INTERVAL_MS");
    expect(appSource).not.toContain("animateToSampledBottom");
  });


  it("remeasures virtual Markdown blocks when CodeMirror changes real geometry", () => {
    expect(appSource).toContain("const VirtualMarkdownMeasuredBlock = memo");
    expect(appSource).toMatch(/const observer = new ResizeObserver\(measure\);[\s\S]{0,80}observer\.observe\(element\)/);
    expect(appSource).toContain("onMeasuredHeight={updateMeasuredBlockHeight}");
  });

  it("ends Thinking as soon as assistant text begins, not at agent settlement", () => {
    expect(appSource).toMatch(/update\?\.type === "text_start"[\s\S]{0,220}patchItem\(thinkingId\.current, \{ state: "done" \}\)/);
    expect(appSource).toMatch(/update\?\.type === "text_delta"[\s\S]{0,220}patchItem\(thinkingId\.current, \{ state: "done" \}\)/);
    expect(appSource).toMatch(/update\?\.type === "text_end"[\s\S]{0,220}patchItem\(thinkingId\.current, \{ state: "done" \}\)/);
  });
  it("freezes the visible transcript while authoritative Pi state keeps updating", () => {
    expect(appSource).toContain("const [frozenTranscriptItems, setFrozenTranscriptItems]");
    expect(appSource).toContain("const visibleTranscriptItems = frozenTranscriptItems ?? items");
    expect(appSource).toMatch(/const snapshot = committedVisibleTranscriptItemsRef\.current;[\s\S]{0,120}setFrozenTranscriptItems\(snapshot\)/);
    expect(appSource).toContain("items={visibleTranscriptItems}");
  });

  it("flushes frozen generation once at agent_settled and preserves a logical reader anchor", () => {
    expect(appSource).toMatch(/case "agent_settled"[\s\S]{0,2500}flushFrozenTranscriptAtSettle\(\)/);
    expect(appSource).toMatch(/holdReaderAnchorThroughFinalFlush\(\)[\s\S]{0,180}setFrozenTranscriptItems\(null\)/);
    expect(appSource).toContain("captureReaderScrollAnchor()");
    expect(appSource).toContain("readerScrollTopForAnchor({");
  });

  it("lets explicit reader input own the viewport until the reader actually reaches bottom", () => {
    expect(appSource).toMatch(/event\.deltaY < 0[\s\S]{0,120}disableAutoFollow\(true\)/);
    expect(appSource).toContain("keyboardStopsAutoFollow(event.key)");
    expect(appSource).toContain("shouldResumeAutoFollowFromManualScroll({");
    expect(appSource).toContain("resumeAutoFollow()");
  });

  it("does not keep the v0.36.19 monotonic virtual-row height floor", () => {
    expect(appSource).not.toContain("monotonicStreamingMeasurement(");
    expect(appSource).toMatch(/measuredHeightsRef\.current\.set\(key, rawHeight\);[\s\S]{0,40}return rawHeight;/);
  });

  it("keeps TanStack from becoming a second scroll writer during streaming/final flush", () => {
    expect(appSource).toMatch(
      /virtualizer\.shouldAdjustScrollPositionOnItemSizeChange\s*=\s*disableVirtualizerScrollCorrection[\s\S]{0,100}\?\s*\(\)\s*=>\s*false/,
    );
    expect(appSource).toContain("disableVirtualizerScrollCorrection={isStreaming || visualFlushSettling}");
  });

  it("keeps native browser scroll anchoring disabled like old Molten Forge", () => {
    expect(styles).toMatch(/\.transcript\s*\{[^}]*overflow-anchor:\s*none;/);
    expect(styles).toMatch(/\.transcript-content\s*\{[^}]*overflow-anchor:\s*none;/);
  });

  it("marks height-changing activity controls as reader intent", () => {
    const markers = appSource.match(/data-reader-layout-interaction="true"/g) ?? [];
    expect(markers.length).toBeGreaterThanOrEqual(3);
    expect(appSource).toContain("target?.closest(READER_LAYOUT_INTERACTION_SELECTOR)");
    expect(appSource).toContain("keyboardActivatesReaderLayoutInteraction(event.key)");
    expect(appSource).toMatch(/READER_LAYOUT_INTERACTION_SELECTOR[\s\S]{0,300}disableAutoFollow\(true\)/);
    expect(appSource).toContain("holdReaderAnchorThroughLayoutChange()");
  });

  it("derives activity expansion from lifecycle/manual override instead of a remount-sensitive wasRunning ref", () => {
    expect(appSource).toContain("resolveActivityExpanded(manualExpandedOverride, running, autoExpandThinking)");
    expect(appSource).toContain("resolveActivityExpanded(manualExpandedOverride, running, autoExpandTools)");
    expect(appSource).not.toContain("const wasRunning = useRef(running)");
  });

  it("bounds active thinking but lets completed expanded reasoning use natural height", () => {
    expect(styles).toMatch(/\.user-bubble\s*\{[\s\S]*?max-height:\s*clamp\(240px,\s*44dvh,\s*480px\);[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.thinking\.running \.thinking-content\s*\{[\s\S]*?max-height:\s*min\(52dvh,\s*560px\);[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.thinking:not\(\.running\) \.thinking-content\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow-y:\s*visible;/);
  });

  it("auto-follows only the nested thinking pane while reasoning is running", () => {
    expect(appSource).toContain("const thinkingContentRef = useRef<HTMLDivElement | null>(null)");
    expect(appSource).toContain("if (!running || !expanded) return");
    expect(appSource).toContain("content.scrollHeight <= content.clientHeight");
    expect(appSource).toContain("content.scrollTop = content.scrollHeight");
    expect(appSource).toContain('className="thinking-content" ref={thinkingContentRef}');

    const effectStart = appSource.indexOf("const thinkingContentRef = useRef<HTMLDivElement | null>(null)");
    const effectEnd = appSource.indexOf("const preview = displayedThinkingPreview", effectStart);
    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(appSource.slice(effectStart, effectEnd)).not.toContain("transcriptRef");
    expect(appSource.slice(effectStart, effectEnd)).not.toContain("disableAutoFollow");
  });

  it("mirrors the rendered transcript geometry into composer-adjacent surfaces", () => {
    expect(appSource).toContain("chatContentGeometry(");
    expect(appSource).toContain('setProperty("--chat-content-physical-width"');
    expect(appSource).toContain('setProperty("--chat-content-center-offset"');
    expect(styles).toMatch(/\.composer,[\s\S]*?--chat-content-physical-width/);
    expect(styles).toMatch(/\.composer,[\s\S]*?--chat-content-center-offset/);
    expect(styles).toMatch(/\.command-menu\s*\{[\s\S]*?--chat-content-center-offset/);
    expect(styles).toMatch(/\.chat-width-guides\s*\{[\s\S]*?--chat-content-center-offset/);
  });
  it("keeps composer alignment stable across empty/history/loading transcript states", () => {
    expect(styles).toMatch(/\.transcript\.transcript-empty[\s\S]{0,160}scrollbar-gutter:\s*stable;/);
    expect(styles).toMatch(/\.transcript\.transcript-history-loading[\s\S]{0,160}scrollbar-gutter:\s*stable;/);
    expect(appSource).toContain("[activeSessionPath, chatWidth, connected, settingsOpen, sidebarVisible, switchingFolder]");
    expect(appSource).not.toContain("[chatWidth, connected, historyLoading, items.length, settingsOpen, sidebarVisible, switchingFolder]");
  });

  it("measures the overlay composer and grows transcript bottom clearance without moving the composer", () => {
    expect(appSource).toContain("const composerWrapRef = useRef<HTMLElement | null>(null)");
    expect(appSource).toContain('ref={composerWrapRef}');
    expect(appSource).toContain('observer.observe(composerWrap)');
    expect(appSource).toContain('setProperty("--composer-overlay-clearance"');
    expect(appSource).toContain("composerOverlayClearance(transcriptBottom, composerWrap.getBoundingClientRect().top)");
    expect(appSource).toContain("observer.observe(pane)");
    expect(appSource).toContain('window.addEventListener("resize", onWindowGeometryChange)');
    expect(appSource).toContain("holdReaderAnchorThroughLayoutChange(240)");
    expect(appSource).toContain("scheduleScrollToBottom(true, FORCED_SCROLL_SETTLE_FRAMES)");
    expect(styles).toMatch(/\.transcript:not\(\.transcript-empty\):not\(\.transcript-history-loading\)[\s\S]*?scroll-padding-bottom:\s*var\(--composer-overlay-clearance, 190px\)/);
    expect(styles).toMatch(/\.transcript:not\(\.transcript-empty\):not\(\.transcript-history-loading\) \.transcript-content[\s\S]*?padding-bottom:\s*var\(--composer-overlay-clearance, 190px\)/);
    expect(styles).toMatch(/\.composer-wrap\s*\{[\s\S]*?position:\s*absolute;/);
  });

  it("fades timeline content beneath the floating composer without adding blur or changing scroll geometry", () => {
    expect(appSource).toContain("composerFadeInset(transcriptBottom, composerTop)");
    expect(appSource).toContain('setProperty("--composer-fade-inset"');
    expect(styles).toMatch(/\.transcript:not\(\.transcript-empty\):not\(\.transcript-history-loading\)\s*\{[^}]*mask-image:\s*linear-gradient\(to top,/);
    expect(styles).toMatch(/-webkit-mask-image:\s*linear-gradient\(to top,/);
    expect(styles).toContain("var(--composer-fade-inset, 0px)");
  });

  it("lets nested CodeMirror panes hand wheel scrolling back to the transcript", () => {
    expect(styles).toMatch(/\.chat-code-viewer \.cm-scroller\s*\{[\s\S]*?overscroll-behavior-y:\s*auto;/);
    expect(styles).toMatch(/\.tool-text-viewer,[\s\S]*?\.thinking-content\s*\{[\s\S]*?overscroll-behavior-y:\s*auto;/);
  });

  it("forwards wheel input from chat-width resize gutters into the transcript", () => {
    expect(appSource).toContain("const handleChatResizeWheel = useCallback");
    expect(appSource).toContain("transcript.scrollTop += event.deltaY * multiplier");
    expect(appSource).toContain("onWheel={handleChatResizeWheel}");
  });

  it("keeps running tool auto-follow local to the tool payload scrollers", () => {
    expect(appSource).toContain("const inputScrollRef = useRef<HTMLPreElement | null>(null)");
    expect(appSource).toContain("const outputScrollRootRef = useRef<HTMLDivElement | null>(null)");
    expect(appSource).toContain("inputTarget.scrollTop = inputTarget.scrollHeight");
    expect(appSource).toContain("target.scrollTop = target.scrollHeight");

    const effectStart = appSource.indexOf("const useOutput = Boolean(item.toolExecutionStarted && output.trim())");
    const effectEnd = appSource.indexOf("const preview = running ? sampledLivePreview : completedPreview", effectStart);
    const effect = appSource.slice(effectStart, effectEnd);
    expect(effect).not.toContain("disableAutoFollow");
    expect(effect).not.toContain("transcriptRef");
    expect(effect).not.toContain("scrollTranscript");
  });

  it("keeps the transcript mounted behind Settings and preserves reflow-sensitive reader position", () => {
    expect(appSource).toContain('${settingsOpen ? "settings-covered" : ""}');
    expect(appSource).toContain("preserveChatViewportThroughSettingsChange");
    expect(appSource).toContain("onAppFontFamilyChange={(font) => preserveChatViewportThroughSettingsChange");
    expect(appSource).toContain("onAutoExpandThinkingChange={(value) => preserveChatViewportThroughSettingsChange");
    expect(appSource).toContain("onAutoExpandToolsChange={(value) => preserveChatViewportThroughSettingsChange");
    expect(styles).toMatch(/\.workspace\.settings-covered\s*\{[\s\S]*?visibility:\s*hidden;/);
  });

  it("shows an explicit jump-to-bottom control only when meaningfully away and jumps immediately", () => {
    expect(appSource).toContain("shouldShowScrollToBottomButton(distanceFromBottom)");
    expect(appSource).toContain("showScrollToBottomButton && !historyLoading && items.length > 0");
    expect(appSource).toContain('aria-label="Scroll to bottom"');
    expect(appSource).toContain("transcript.scrollTop = target");
    expect(appSource).toContain("setAutoScrollMode(true)");
    expect(styles).toMatch(/\.scroll-to-bottom-anchor\s*\{[\s\S]*?bottom:\s*calc\(var\(--composer-overlay-clearance, 190px\) - 6px\)/);
  });


});
