import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, FolderOpen, Maximize2, RefreshCw, Search, X } from "lucide-react";
import type { CommandInfo } from "../core/chat-logic";
import { groupResourcesByScope, mergePiCommands, type ResourceRecord } from "../core/pi-resources";
import { ReadOnlyCodeViewer } from "./code-viewer";
import type { PiResources } from "./pi-resources-settings";

/* The split-pane structure follows the original Electron Skills dialog:
   left: search / skill rows / fixed actions; right: header / scrolling fields.
   Pi owns skills; this is intentionally read-only. */

function ReadOnlySkill({ skill }: { skill: ResourceRecord }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    if (!skill.path) {
      setError("No SKILL.md path is available for this skill.");
      return;
    }
    void invoke<string>("read_pi_skill", { path: skill.path }).then((value) => {
      if (!cancelled) setContent(value);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(String(reason));
    });
    return () => { cancelled = true; };
  }, [skill.path]);

  const viewer = content === null ? (
    <p role={error ? "alert" : "status"} className="pi-skill-preview-status">
      {error ?? "Reading SKILL.md…"}
    </p>
  ) : <ReadOnlyCodeViewer code={content} language="markdown" wrapped lineNumbers className="pi-skill-code-viewer" ariaLabel={`${skill.name} SKILL.md read-only content`} />;

  const openFolder = async () => {
    setFolderError(null);
    try { await invoke("open_resource_folder", { path: skill.path }); }
    catch (reason) { setFolderError(String(reason)); }
  };

  return (
    <div className="pi-skill-detail-pane">
      <header className="pi-skill-detail-header"><h2>{skill.name}</h2></header>
      <div className="pi-skill-detail-scroll">
        <div className="pi-skill-detail-fields">
          <div className="pi-skill-field">
            <span className="pi-skill-field-label">Description</span>
            <div className="pi-skill-readonly-field pi-skill-description" aria-label="Skill description">{skill.description || "No description available."}</div>
          </div>
          <div className="pi-skill-field">
            <span className="pi-skill-field-label">Location</span>
            <div className="pi-skill-location-row">
              <div className="pi-skill-readonly-field pi-skill-location" title={skill.path}>{skill.path || "Unavailable"}</div>
              <button type="button" className="pi-skill-icon-button" disabled={!skill.path} onClick={() => void openFolder()} title="Open skill folder" aria-label={`Open ${skill.name} folder`}><FolderOpen size={16} /></button>
            </div>
          </div>
          {folderError && <p className="settings-inline-error" role="alert">{folderError}</p>}
          <div className="pi-skill-field">
            <div className="pi-skill-preview-title">
              <span className="pi-skill-field-label">SKILL.md</span>
              {content !== null && <button type="button" className="pi-skill-text-button" onClick={() => setExpanded(true)}><Maximize2 size={15} /> View skill</button>}
            </div>
            <div className="pi-skill-editor-frame">{viewer}</div>
          </div>
        </div>
      </div>
      {expanded && content !== null && createPortal(<div className="pi-skill-view-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
        <section className="pi-skill-view-dialog" role="dialog" aria-modal="true" aria-label={`View ${skill.name}`}>
          <header className="pi-skill-view-dialog-header"><strong>{skill.name} / SKILL.md</strong><button className="icon-button pi-skill-view-close" type="button" onClick={() => setExpanded(false)} title="Close" aria-label="Close skill viewer" autoFocus><X size={17} /></button></header>
          <div className="pi-skill-view-dialog-content"><ReadOnlyCodeViewer code={content} language="markdown" wrapped lineNumbers className="pi-skill-code-viewer" ariaLabel={`${skill.name} full read-only SKILL.md`} /></div>
        </section>
      </div>, document.body)}
    </div>
  );
}

export function PiSkillsSettings({ cwd, commands, onReloadSkills, reloadDisabled = false }: {
  cwd: string;
  commands: readonly CommandInfo[];
  onReloadSkills?: () => Promise<void>;
  reloadDisabled?: boolean;
}) {
  const [data, setData] = useState<PiResources | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<PiResources>("list_pi_resources", { cwd }).then((result) => {
      if (!cancelled) setData(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(String(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, revision]);

  const skills = useMemo(() => mergePiCommands(data?.skills ?? [], commands, "skill").filter((skill) => {
    const q = query.trim().toLowerCase();
    return !q || [skill.name, skill.description, skill.path].some((value) => value.toLowerCase().includes(q));
  }), [data, commands, query]);
  const groups = useMemo(() => groupResourcesByScope(skills), [skills]);
  const selected = skills.find((skill) => skill.path === selectedPath) ?? skills[0];

  const reload = async () => {
    if (reloadDisabled || reloading) return;
    setReloading(true);
    setError(null);
    try {
      if (onReloadSkills) await onReloadSkills();
      setRevision((value) => value + 1);
    } catch (reason) { setError(`Failed to reload Pi skills: ${String(reason)}`); }
    finally { setReloading(false); }
  };
  const openGlobalFolder = async () => {
    setFolderError(null);
    try { await invoke("open_pi_resource_root", { kind: "skills" }); }
    catch (reason) { setFolderError(String(reason)); }
  };

  return (
    <div className="pi-skills-workspace">
      <aside className="pi-skills-list-pane">
        <div className="pi-skills-search-header">
          <div className="pi-skills-search-box">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills" aria-label="Search skills" />
            {query && <button type="button" onClick={() => setQuery("")} title="Clear search" aria-label="Clear skills search"><X size={14} /></button>}
          </div>
        </div>
        <div className="pi-skills-list-scroll" aria-label="Discovered skills">
          {loading || reloading ? <p className="pi-skills-list-status" role="status">{reloading ? "Reloading skills…" : "Discovering skills…"}</p> : error ? <p className="pi-skills-list-status" role="alert">{error}</p> : groups.length ? groups.map((group) => (
            <section className="pi-skills-group" key={group.scope}>
              <h3>{group.title}</h3>
              {group.items.map((skill) => (
                <button type="button" key={`${skill.scope}:${skill.path}`} className={`pi-skills-list-item${selected?.path === skill.path ? " active" : ""}`} aria-pressed={selected?.path === skill.path} onClick={() => setSelectedPath(skill.path)} title={skill.path}>
                  <BookOpen size={16} aria-hidden="true" />
                  <span className="pi-skills-list-item-copy"><strong>{skill.name}</strong><small>{skill.description || "No description."}</small></span>
                </button>
              ))}
            </section>
          )) : <p className="pi-skills-list-status">{query ? "No matching skills." : "No skills discovered."}</p>}
          {data?.warnings?.length ? <div className="pi-skills-list-warnings">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        </div>
        <footer className="pi-skills-list-footer">
          <button type="button" title="Open global skills folder" aria-label="Open global skills folder" onClick={() => void openGlobalFolder()}><FolderOpen size={17} /></button>
          <button type="button" title="Reload skills (restart Pi)" aria-label="Reload skills" disabled={loading || reloading || reloadDisabled} onClick={() => void reload()}><RefreshCw size={17} /></button>
        </footer>
        {folderError && <p className="pi-skills-footer-error" role="alert">{folderError}</p>}
      </aside>
      {selected ? <ReadOnlySkill key={`${selected.scope}:${selected.path}`} skill={selected} /> : <section className="pi-skill-detail-pane"><header className="pi-skill-detail-header"><h2>Skills</h2></header><div className="pi-skill-detail-empty">{loading ? "Discovering skills…" : "Select a skill to inspect its contents."}</div></section>}
    </div>
  );
}
