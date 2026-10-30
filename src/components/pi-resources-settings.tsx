import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileCode2, FolderOpen, RefreshCw, Search } from "lucide-react";
import type { CommandInfo } from "../core/chat-logic";
import { groupResourcesByScope, mergePiCommands, type ResourceRecord } from "../core/pi-resources";

export type PiResourceInfo = ResourceRecord;
export type PiResources = { skills: PiResourceInfo[]; extensions: PiResourceInfo[]; packages: PiResourceInfo[]; warnings: string[] };

function matches(resource: PiResourceInfo, query: string) {
  const term = query.trim().toLowerCase();
  return !term || [resource.name, resource.path, resource.description, resource.scope]
    .some((part) => part.toLowerCase().includes(term));
}

function ResourceRow({ resource }: { resource: PiResourceInfo }) {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try { await invoke("open_resource_folder", { path: resource.path }); }
    catch (reason) { setError(String(reason)); }
  };
  return (
    <div className="settings-resource-row">
      <span className="settings-resource-icon settings-row-icon" aria-hidden="true"><FileCode2 size={17} /></span>
      <div className="settings-resource-content settings-row-copy">
        <div className="settings-resource-heading">
          <strong title={resource.name}>{resource.name}</strong>
          {resource.runtimeCommand && <span className="settings-resource-command" title="Reported by Pi">{resource.runtimeCommand}</span>}
        </div>
        {resource.description && <div className="settings-resource-description">{resource.description}</div>}
        {resource.path && <div className="settings-resource-path" title={resource.path}>{resource.path}</div>}
        {error && <div className="settings-inline-error" role="alert">{error}</div>}
      </div>
      {resource.path && <button className="icon-button settings-resource-folder-action" type="button" onClick={() => void open()} title={`Open ${resource.name} folder`} aria-label={`Open folder for ${resource.name}`}><FolderOpen size={16} /></button>}
    </div>
  );
}

/** Pi extensions stay a compact read-only inventory. Skills have their own full-height workspace. */
export function PiResourcesSettings({ cwd, commands }: { cwd: string; commands: readonly CommandInfo[] }) {
  const [data, setData] = useState<PiResources | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<PiResources>("list_pi_resources", { cwd }).then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, revision]);

  const list = useMemo(() => mergePiCommands(data?.extensions ?? [], commands, "extension")
    .filter((item) => matches(item, search)), [data, commands, search]);
  const groups = useMemo(() => groupResourcesByScope(list), [list]);
  const packages = useMemo(() => (data?.packages ?? []).filter((item) => matches(item, search)), [data, search]);

  return (
    <div className="settings-page-scroll">
      <div className="settings-page-content">
        <section className="settings-section">
          <div className="settings-resource-section-title">
            <h2>Extensions</h2>
            <div className="settings-resource-top-actions">
              <button type="button" className="settings-choose-button settings-resource-refresh" onClick={() => setRevision((value) => value + 1)} disabled={loading}><RefreshCw size={16} /> Refresh</button>
            </div>
          </div>
          <div className="settings-resource-search settings-panel"><Search size={17} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search extensions…" aria-label="Search extensions" /></div>
          <p className="settings-resource-caption">Executable extensions have Pi's operating-system permissions. Discovery does not guarantee an extension is loaded.</p>
          {loading ? <p className="settings-resource-status" role="status">Discovering extensions…</p>
            : error ? <p className="settings-resource-status error" role="alert">{error}</p>
              : <>
                <p className="settings-resource-count">{list.length} extensions {search.trim() ? "matching search" : "discovered"}</p>
                {groups.map((group) => <section className="settings-section settings-resource-group" key={group.scope}>
                  <h2>{group.title}</h2>
                  <div className="settings-panel settings-resource-list">{group.items.map((item) => <ResourceRow key={`${item.kind}:${item.scope}:${item.path}`} resource={item} />)}</div>
                </section>)}
                {list.length === 0 && <div className="settings-panel"><p className="settings-resource-status">{search ? "No matching extensions." : "No extensions found in discovered directories or Pi commands."}</p></div>}
                {packages.length > 0 && <section className="settings-section settings-resource-packages"><h2>Configured Pi packages</h2><p className="settings-resource-caption">Packages can contain skills and extensions; their contents are not enumerated here.</p><div className="settings-panel settings-resource-list">{packages.map((item) => <ResourceRow key={`${item.scope}:${item.name}`} resource={item} />)}</div></section>}
              </>}
          {data?.warnings.length ? <div className="settings-resource-warnings">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        </section>
      </div>
    </div>
  );
}
