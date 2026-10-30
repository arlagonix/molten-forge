import { memo, useMemo } from "react";
import type { CommandInfo } from "../core/chat-logic";
import { formatPiStartupVersion, piStartupSections } from "../core/pi-startup";

type PiStartupWelcomeProps = {
  piVersion: string | null;
  commands: CommandInfo[];
};

export const PiStartupWelcome = memo(function PiStartupWelcome({
  piVersion,
  commands,
}: PiStartupWelcomeProps) {
  const sections = useMemo(() => piStartupSections(commands), [commands]);
  const versionLabel = formatPiStartupVersion(piVersion);
  const versionSuffix = versionLabel === "pi" ? "" : versionLabel.slice(2);

  return (
    <div className="pi-startup-welcome" aria-label="Pi startup information">
      <div className="pi-startup-logo"><strong>pi</strong>{versionSuffix && <span>{versionSuffix}</span>}</div>
      <div className="pi-startup-muted">escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more</div>
      <div className="pi-startup-muted">Press ctrl+o to show full startup help and loaded resources.</div>

      <div className="pi-startup-onboarding">Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.</div>

      {sections.map((section) => (
        <div className="pi-startup-section" key={section.title}>
          <div className="pi-startup-section-title">[{section.title}]</div>
          <div className="pi-startup-resource-list">{section.items.join(", ")}</div>
        </div>
      ))}
    </div>
  );
});
