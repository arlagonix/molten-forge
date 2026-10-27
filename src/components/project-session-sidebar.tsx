import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Folder, FolderOpen, Plus } from "lucide-react";
import { formatSessionDate } from "../core/session-display";
import { projectNameFromPath } from "../core/recent-projects";
import {
  PROJECT_PAGE_SIZE, SESSION_BATCH_SIZE, nextVisibleSessionCount, orderedProjectPaths,
  projectKeyForSidebar, sortProjectPaths, sortSessionsByActivity, type ProjectSummary,
} from "../core/project-sidebar";

export type SidebarSession = {
  path: string;
  id: string;
  name?: string | null;
  firstMessage?: string | null;
  timestamp?: string | null;
  activityTimestamp?: string | null;
  modifiedAt: number;
};

type Props = {
  cwd: string;
  recentProjects: readonly string[];
  projects: readonly ProjectSummary[];
  sessions: readonly SidebarSession[];
  sessionsLoading: boolean;
  sessionsError: boolean;
  missingProjectPath?: string | null;
  activeSessionPath: string | null;
  disabled: boolean;
  newSessionBusy: boolean;
  onOpenSession: (session: SidebarSession) => void;
  onActivateProject: (project: string) => void;
  onNewSessionInProject: (project: string) => void;
  onOpenInExplorer: (project: string) => void;
};

function titleForSession(session: SidebarSession): string {
  const title = session.name?.trim() || session.firstMessage?.trim() || "New session";
  return title.length > 100 ? `${title.slice(0, 99)}…` : title;
}

export function ProjectSessionSidebar({
  cwd, recentProjects, projects, sessions, sessionsLoading, sessionsError, missingProjectPath, activeSessionPath,
  disabled, newSessionBusy, onOpenSession, onActivateProject, onNewSessionInProject, onOpenInExplorer,
}: Props) {
  const activeKey = projectKeyForSidebar(cwd);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [visibleProjects, setVisibleProjects] = useState(PROJECT_PAGE_SIZE);
  const [leaving, setLeaving] = useState<{ key: string; sessions: SidebarSession[] } | null>(null);
  // New projects open only after their complete session list is ready.
  // Deferring the class change by one frame gives CSS a real 0 -> 1fr
  // transition instead of instantly displaying an already-expanded list.
  const [openedKey, setOpenedKey] = useState(activeKey && !sessionsLoading ? activeKey : "");
  const previous = useRef({ key: activeKey, sessions: [...sessions] });
  const viewport = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const activeChildrenRef = useRef<HTMLDivElement | null>(null);
  const pendingBatchAnimationRef = useRef<{ key: string; from: number } | null>(null);
  const batchAnimationRef = useRef<Animation | null>(null);

  const changeVisibleSessionCount = (key: string, current: number, total: number, direction: "more" | "less") => {
    const next = nextVisibleSessionCount(current, total, direction);
    if (next === current) return;
    // Record geometry before React changes the children. The animation is
    // intentionally restricted to explicit Show more / Show less clicks.
    const container = activeChildrenRef.current;
    if (container) pendingBatchAnimationRef.current = { key, from: container.getBoundingClientRect().height };
    setCounts((all) => ({ ...all, [key]: next }));
  };

  useLayoutEffect(() => {
    const pending = pendingBatchAnimationRef.current;
    if (!pending) return;
    pendingBatchAnimationRef.current = null;
    const container = activeChildrenRef.current;
    if (pending.key !== activeKey || !container || sessionsLoading || sessionsError) return;
    batchAnimationRef.current?.cancel();
    const to = container.scrollHeight;
    if (Math.abs(to - pending.from) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    container.style.overflow = "hidden";
    const animation = container.animate(
      [{ height: `${pending.from}px` }, { height: `${to}px` }],
      { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    batchAnimationRef.current = animation;
    const cleanup = () => {
      if (batchAnimationRef.current !== animation) return;
      container.style.overflow = "";
      batchAnimationRef.current = null;
    };
    animation.addEventListener("finish", cleanup, { once: true });
    animation.addEventListener("cancel", cleanup, { once: true });
  }, [counts, activeKey, sessionsLoading, sessionsError]);

  useEffect(() => () => { batchAnimationRef.current?.cancel(); }, []);

  useEffect(() => {
    const old = previous.current;
    if (old.key && old.key !== activeKey) {
      setLeaving({ key: old.key, sessions: old.sessions });
      const timer = window.setTimeout(() => setLeaving(null), 270);
      previous.current = { key: activeKey, sessions: [...sessions] };
      return () => window.clearTimeout(timer);
    }
    previous.current = { key: activeKey, sessions: [...sessions] };
  }, [activeKey]);
  useEffect(() => {
    if (previous.current.key === activeKey && !sessionsLoading) {
      previous.current.sessions = [...sessions];
    }
  }, [activeKey, sessions, sessionsLoading]);
  useEffect(() => {
    if (!activeKey || sessionsLoading || sessionsError || openedKey === activeKey) return;
    const frame = window.requestAnimationFrame(() => setOpenedKey(activeKey));
    return () => window.cancelAnimationFrame(frame);
  }, [activeKey, sessionsError, sessionsLoading, openedKey]);

  const allPaths = useMemo(() => orderedProjectPaths(cwd, [
    ...projects.map((entry) => entry.cwd), ...recentProjects,
  ]), [cwd, recentProjects, projects]);
  const paths = useMemo(() => sortProjectPaths(allPaths, projects, cwd, sessions), [allPaths, projects, cwd, sessions]);
  const sortedSessions = useMemo(() => sortSessionsByActivity(sessions), [sessions]);
  // On the first render after cwd changes the effect that stores `leaving`
  // hasn't run yet. Read the last committed project's rows synchronously,
  // otherwise the outgoing list vanishes before its collapse can animate.
  const departing = previous.current.key && previous.current.key !== activeKey
    ? previous.current : leaving;
  const shown = Math.min(visibleProjects, paths.length);
  useEffect(() => {
    const root = viewport.current, node = sentinel.current;
    if (!root || !node || shown >= paths.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleProjects((count) => Math.min(count + PROJECT_PAGE_SIZE, paths.length));
      }
    }, { root, rootMargin: "120px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, paths.length]);

  return (
    <nav className="session-list project-session-list" aria-label="Projects and Pi sessions" ref={viewport}>
      {paths.slice(0, shown).map((project) => {
        const key = projectKeyForSidebar(project);
        const current = key === activeKey;
        const missing = missingProjectPath ? key === projectKeyForSidebar(missingProjectPath) : false;
        const outgoing = !current && departing?.key === key;
        const expanded = current && openedKey === activeKey;
        const list = current ? sortedSessions : outgoing ? departing.sessions : [];
        const count = counts[key] ?? SESSION_BATCH_SIZE;
        const visible = list.slice(0, count);
        const remaining = Math.max(0, list.length - visible.length);
        const canShowLess = count > SESSION_BATCH_SIZE && visible.length > SESSION_BATCH_SIZE;
        // One status decision for both the already-open list and the initial
        // collapsed/loading transition. A failed refresh must never show stale rows.
        const sessionStatus = !current ? null : sessionsLoading ? (
          <div className="project-session-loading" role="status">Loading sessions…</div>
        ) : sessionsError ? (
          <div className="project-session-loading" role="alert">Could not load sessions</div>
        ) : null;
        return (
          <section className="project-session-group" key={key} aria-label={projectNameFromPath(project)}>
            <div className={`project-session-heading ${current ? "current" : ""} ${missing ? "missing" : ""}`}>
              <button
                type="button"
                className="project-session-activate"
                title={project}
                aria-current={current ? "true" : undefined}
                aria-expanded={current}
                disabled={current || disabled}
                onClick={() => onActivateProject(project)}
              >
                <Folder size={15} className="project-session-folder" aria-hidden="true" />
                <span className="project-session-name">{projectNameFromPath(project)}</span>
              </button>
              <button
                type="button" className="project-session-explorer icon-button tiny"
                title={`Open ${projectNameFromPath(project)} in Explorer`}
                aria-label={`Open ${projectNameFromPath(project)} in Explorer`}
                onClick={() => onOpenInExplorer(project)}
              ><FolderOpen size={15} /></button>
              <button
                type="button" className="project-session-new icon-button tiny"
                title={`New session in ${projectNameFromPath(project)}`}
                aria-label={`New session in ${projectNameFromPath(project)}`}
                disabled={disabled || (current && newSessionBusy)}
                onClick={() => onNewSessionInProject(project)}
              ><Plus size={15} /></button>
              {current && <span className="project-session-current-indicator" title="Active Pi project" />}
            </div>
            {missing && !current && (
              <div className="project-session-missing" role="status" title={project}>
                Folder not found — use Open Folder above.
              </div>
            )}
            {!expanded && sessionStatus}
            <div className={`project-session-animated ${expanded ? "expanded" : ""} ${outgoing ? "leaving" : ""}`}>
              <div className="project-session-animated-inner">
                <div className="project-session-children" ref={current ? activeChildrenRef : undefined}>
                  {expanded && sessionStatus}
                  {current && !sessionsLoading && !sessionsError && list.length === 0 && <div className="sidebar-empty">No saved conversations</div>}
                  {(!current || (!sessionsLoading && !sessionsError)) && visible.map((session) => (
                    <button
                      key={session.path} type="button"
                      className={`session-row project-session-row ${current && session.path === activeSessionPath ? "active" : ""}`}
                      onClick={() => onOpenSession(session)}
                      disabled={disabled || !current}
                      title={titleForSession(session)}
                    >
                      <span className="session-title">{titleForSession(session)}</span>
                      <span className="session-date">{formatSessionDate(session.activityTimestamp ?? session.timestamp ?? session.modifiedAt)}</span>
                    </button>
                  ))}
                  {current && !sessionsLoading && !sessionsError && (remaining > 0 || canShowLess) && (
                    <div className="project-session-pagination">
                      {remaining > 0 && <button type="button" className="project-session-show-more" onClick={() => changeVisibleSessionCount(key, count, list.length, "more")}>
                        Show 5 more ({remaining})
                      </button>}
                      {canShowLess && <button type="button" className="project-session-show-more" onClick={() => changeVisibleSessionCount(key, count, list.length, "less")}>Show less</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      })}
      {shown < paths.length && <div ref={sentinel} className="project-session-page-sentinel" aria-hidden="true" />}
    </nav>
  );
}
