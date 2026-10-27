import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSessionSidebar, type SidebarSession } from "./project-session-sidebar";

const sessions: SidebarSession[] = Array.from({ length: 8 }, (_, i) => ({
  id: String(i), path: `/repo/session-${i}.jsonl`, name: `Conversation ${i}`,
  timestamp: "2026-10-21T10:00:00Z", modifiedAt: 0,
}));

function render(override: Partial<Parameters<typeof ProjectSessionSidebar>[0]> = {}) {
  return renderToStaticMarkup(createElement(ProjectSessionSidebar, {
    cwd: "/repo", recentProjects: ["/another"], projects: [], sessions,
    sessionsLoading: false, sessionsError: false,
    activeSessionPath: sessions[0].path, disabled: false, newSessionBusy: false,
    onOpenSession: () => {}, onActivateProject: () => {}, onNewSessionInProject: () => {}, onOpenInExplorer: () => {},
    ...override,
  }));
}

describe("collapsible workspace sessions", () => {
  it("expands only the active project, with five visible chats and Show more", () => {
    const markup = render();
    expect(markup).toContain('aria-label="Projects and Pi sessions"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Conversation 0");
    expect(markup).toContain("Conversation 4");
    expect(markup).not.toContain("Conversation 5");
    expect(markup).toContain("Show 5 more (3)");
  });

  it("retains the selected session styling and disables navigation during generation", () => {
    const markup = render({ disabled: true });
    expect(markup).toMatch(/class="session-row project-session-row active"[^>]*disabled/);
    expect(markup).toContain('title="Active Pi project"');
  });

  it("handles an empty active project without invented conversations", () => {
    const markup = render({ sessions: [], activeSessionPath: null });
    expect(markup).toContain("No saved conversations");
    expect(markup).not.toContain("Show 5 more");
    expect(markup).toContain("Open repo in Explorer");
  });

  it("shows one loading placeholder, never stale session rows, until a new project is ready", () => {
    const markup = render({ sessionsLoading: true });
    expect(markup.match(/Loading sessions…/g)).toHaveLength(1);
    expect(markup).not.toContain("Conversation 0");
    expect(markup).not.toContain("No saved conversations");
    expect(markup).not.toContain("Could not load sessions");
  });

  it("shows a missing-folder message in the inactive group without hiding the current conversation", () => {
    const markup = render({ missingProjectPath: "/another" });
    expect(markup).toContain("Folder not found");
    expect(markup).toContain("Conversation 0");
    expect(markup).not.toContain("Could not load sessions");
  });

  it("shows load failures in the expanded project instead of an empty list", () => {
    const markup = render({ sessions: [], sessionsError: true });
    expect(markup).toContain('role="alert">Could not load sessions');
    expect(markup).not.toContain("No saved conversations");
  });

  it("never exposes stale conversations when the expanded project session lookup fails", () => {
    const markup = render({ sessionsError: true });
    expect(markup.match(/Could not load sessions/g)).toHaveLength(1);
    expect(markup).not.toContain("Conversation 0");
    expect(markup).not.toContain("Show 5 more");
  });
});


describe("sidebar transition and selection contracts", () => {
  it("renders the full-row selectable session surface, not an inset title badge", () => {
    const markup = render();
    expect(markup).toContain('class="session-row project-session-row active"');
    expect(markup).toContain('class="project-session-animated expanded');
    expect(markup).not.toContain('project-session-chat-icon');
  });
});


describe("sidebar pagination animation contracts", () => {
  it("animates batches only when requested and respects reduced motion", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(process.cwd(), "src/components/project-session-sidebar.tsx"), "utf8");
    expect(source).toContain("pendingBatchAnimationRef.current");
    expect(source).toContain("container.animate(");
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('direction: "more" | "less"');
  });
});


describe("project new-session action", () => {
  it("shows an independently focusable new-session button for active and inactive projects", () => {
    const markup = render();
    expect(markup).toContain('aria-label="New session in repo"');
    expect(markup).toContain('aria-label="New session in another"');
    expect(markup).toContain('project-session-new');
  });
});

describe("project quick-action hover styling", () => {
  it("reveals Explorer and New session together on hover, not just on parent focus", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.project-session-heading:hover \.project-session-explorer,[\s\S]*?\.project-session-heading:hover \.project-session-new/);
    expect(css).not.toContain(".project-session-heading:focus-within .project-session-new");
    expect(css).toContain(".project-session-new:focus-visible");
    expect(css).toMatch(/\.project-session-new:hover:not\(:disabled\)\s*\{\s*cursor:\s*pointer;/);
  });
});
