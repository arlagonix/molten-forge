import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceRootsControl } from "@/components/ai-chat/workspace-roots-control";

const root = {
  id: "workspace-1",
  name: "Project A",
  path: "/work/project-a",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("WorkspaceRootsControl", () => {
  it("renders the selected workspace name with normal button text weight", () => {
    render(
      <WorkspaceRootsControl
        activeChatExists
        roots={[root]}
        open={false}
        onOpenChange={vi.fn()}
        onAddRoot={vi.fn()}
        onRemoveRoot={vi.fn()}
        onOpenRoot={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: "Manage workspace folder for this chat",
    });
    const label = screen.getByText("Project A");

    expect(trigger).toHaveClass("font-normal");
    expect(label).toHaveClass("font-normal");
    expect(label).not.toHaveClass("font-medium");
  });
});
