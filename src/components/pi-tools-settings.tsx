import { useMemo, useState } from "react";
import { Search, Wrench } from "lucide-react";
import type { TranscriptItem } from "../core/chat-logic";
import { observedPiTools } from "../core/observed-pi-tools";

export function PiToolsSettings({ items }: { items: readonly TranscriptItem[] }) {
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const all = useMemo(() => observedPiTools(items), [items]);
  const filtered = useMemo(() => all.filter((tool) => tool.name.toLowerCase().includes(query.trim().toLowerCase())), [all, query]);
  const selected = filtered.find((tool) => tool.name === selectedName) ?? filtered[0];
  return (
    <div className="settings-page-scroll">
      <div className="settings-page-content">
        <section className="settings-section">
          <h2>Tools</h2>
          <p className="settings-resource-caption">Tools observed in this conversation. Pi RPC does not expose a complete inventory of registered or active tools; tools not yet used will not appear here.</p>
          <div className="settings-resource-search settings-panel">
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search observed tools…" aria-label="Search observed tools" />
          </div>
          {filtered.length ? (
            <div className="settings-resource-browser">
              <div className="settings-panel settings-resource-browser-list" role="group" aria-label="Observed tools">
                {filtered.map((tool) => (
                  <button key={tool.name} type="button" className={`settings-resource-browser-item${selected?.name === tool.name ? " active" : ""}`} onClick={() => setSelectedName(tool.name)} aria-pressed={selected?.name === tool.name}>
                    <Wrench size={16} aria-hidden="true" />
                    <span>{tool.name}</span>
                  </button>
                ))}
              </div>
              <div className="settings-panel settings-resource-browser-detail" aria-live="polite">
                <h3>{selected?.name}</h3>
                <div className="settings-resource-metadata-row"><span>Invocations in this conversation</span><strong>{selected?.invocations}</strong></div>
                <div className="settings-resource-metadata-row"><span>Last observed status</span><strong>{selected?.latestState}</strong></div>
                <p className="settings-resource-caption">Usage history only. This does not establish whether the tool is currently enabled or available to the model.</p>
              </div>
            </div>
          ) : <div className="settings-panel"><p className="settings-resource-status">{query ? "No matching tool calls." : "No Pi tool calls observed in this conversation yet."}</p></div>}
        </section>
      </div>
    </div>
  );
}
