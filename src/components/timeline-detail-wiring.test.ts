import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = fs.readFileSync(path.resolve("src/App.tsx"), "utf8");
const settings = fs.readFileSync(path.resolve("src/components/settings-view.tsx"), "utf8");
const css = fs.readFileSync(path.resolve("src/styles.css"), "utf8");

describe("Compact / Full timeline wiring", () => {
  it("exposes three modes and stores the choice separately from expansion preferences", () => {
    expect(settings).toContain('{ value: "compact", label: "Compact" }');
    expect(settings).toContain('{ value: "full", label: "Full" }');
    expect(settings).toContain('{ value: "semi-compact", label: "Semi Compact" }');
    expect(app).toContain('const TIMELINE_MODE_STORAGE_KEY = "molten-forge-pi-timeline-mode"');
    expect(app).toContain('readTimelineMode(window.localStorage, TIMELINE_MODE_STORAGE_KEY)');
    expect(app).toContain('window.localStorage.setItem(TIMELINE_MODE_STORAGE_KEY, timelineMode)');
    expect(app).toContain('onTimelineModeChange={(value) => preserveChatViewportThroughSettingsChange(() => setTimelineMode(value))}');
  });

  it("renders Full only at the live Pi activity frontier and animates back to Used on completion", () => {
    expect(app).toContain('activeSemiCompactActivity(turns, isStreaming)');
    expect(app).toContain('activeSemiCompactGroupKey={turn.key === liveActivity?.turnKey ? liveActivity.groupKey : null}');
    expect(app).toContain('active={group.key === activeSemiCompactGroupKey}');
    expect(app).toContain('<MemoFullActivityEpisode items={items} />');
    expect(app).toContain('<MemoCompactRuntimeTranscriptGroup items={items} blocks={blocks} />');
    expect(app).toContain('inert={!active}');
    expect(app).toContain('inert={active}');
    expect(app).toContain('onTransitionEnd={finishTransition}');
    expect(css).toContain('grid-template-rows: 0fr;');
    expect(css).toContain('grid-template-rows: 1fr;');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.semi-compact-activity.is-open .semi-compact-full-reveal');
  });

  it("folds completed work only after Pi settlement and keeps final prose visible", () => {
    expect(app).toContain('activeRunFirstUserId={activeRunFirstUserId}');
    expect(app).toContain('case "agent_settled"');
    expect(app).toContain('setActiveRunFirstUserId(null)');
    expect(app).toContain('completedWorkDisclosure(');
    expect(app).toContain('suppressCompletedWork={isUnsettledWorkTurn(');
    expect(app).toContain('className="compact-tool-summary completed-work-summary"');
    expect(app).toContain('aria-expanded={expanded}');
    expect(app).toContain('<MemoAgentItems items={earlier} activeSemiCompactGroupKey={null} />');
    expect(app).toContain('items={completedWork!.visible}');
    expect(css).toContain('.completed-work-disclosure');
    expect(css).toContain('.completed-work-details');
  });

  it("uses a chevron (not fullscreen) when hovering Bash and other tool headers", () => {
    const start = app.indexOf("function ToolTranscript(");
    const end = app.indexOf("const MemoToolTranscript", start);
    const toolView = app.slice(start, end);
    expect(toolView).toContain("hoverIcon={expanded ? ChevronDown : ChevronRight}");
    expect(toolView).not.toContain("hoverIcon={Maximize2}");
  });

  it("keeps the Worked for disclosure chevron visible at rest and points it down when expanded", () => {
    const start = app.indexOf("function CompletedWorkDisclosure(");
    const end = app.indexOf("const MemoCompletedWorkDisclosure", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const disclosure = app.slice(start, end);
    expect(disclosure).toContain("<ChevronIcon expanded={expanded} />");
    expect(disclosure).not.toContain("HoverSwapActivityIcon");
    expect(disclosure).not.toContain("icon={Wrench}");
  });

  it("preserves Full renderer and shows stable, individually expandable chronological episodes", () => {
    expect(app).toContain('timelineMode !== "full"');
    expect(app).toContain('groupCompactActivityGroups(agentGroups)');
    expect(app).toContain('MemoRuntimeTranscriptGroup key={group.key} items={group.items}');
    expect(app).toContain('segmentRuntimeGroupItems(items)');
    expect(app).toContain('data-parallel-batch={parallelBatch}');
    expect(app).toContain('className="runtime-activity-row"');
    expect(app).toContain('MemoThinkingTranscript item={item}');
    expect(app).toContain('<MemoToolTranscript item={item} compact />');
    expect(app).toContain('data-reader-layout-interaction="true"');
  });

  it("retains virtualization and manual reader anchor when toggling density", () => {
    expect(app).toContain('measuredHeightsRef.current.clear()');
    expect(app).toContain('virtualizer.measure()');
    expect(app).toContain('directDomUpdatesMode: "position"');
    expect(app).toContain('preserveChatViewportThroughSettingsChange');
  });

  it("keeps accessible, full-width Compact dividers in both themes", () => {
    expect(css).toContain('.compact-tool-summary:focus-visible');
    expect(css).toContain('html[data-theme="light"] .compact-tool-summary');
    expect(css).toContain('.compact-activity-row + .compact-activity-row');
    expect(css).toContain('border-top: 1px solid var(--mf-surface-border, var(--border))');
    expect(css).toContain('.compact-tool-label');
    expect(css).toContain('.runtime-activity-row + .runtime-activity-row');
    expect(css).toContain('padding: 7px 10px;');
    expect(css).toContain('border-left: none;');
  });
  it("uses one summary around independent bordered smart blocks rather than one giant list", () => {
    expect(app).toContain('<MemoCompactRuntimeTranscriptGroup key={group.key} items={group.items} blocks={group.blocks} />');
    expect(app).toContain('blocks.map((block) => (');
    expect(app).toContain('className="compact-activity-block"');
    expect(app).toContain('block.map((item) => (');
    expect(css).toContain('.compact-activity-block {');
    expect(css).toMatch(/\.compact-tool-details\s*\{[^}]*border:\s*0;/s);
    expect(css).toMatch(/\.compact-activity-block\s*\{[^}]*border:\s*1px solid/s);
  });

  it("swaps the summary icon with the chevron on hover or keyboard focus", () => {
    expect(app).toContain('hoverIcon={expanded ? ChevronDown : ChevronRight}');
    expect(app).toContain('<HoverSwapActivityIcon');
    expect(css).toContain('.compact-tool-summary:is(:hover, :focus-visible) .activity-base-icon');
    expect(css).toContain('.compact-tool-summary:is(:hover, :focus-visible) .activity-expand-icon');
    expect(app).not.toContain('size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />');
  });

});
