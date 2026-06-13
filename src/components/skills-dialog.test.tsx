import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillsDialog } from "@/components/skills-dialog";
import type { LoadedSkillInfo, SkillsSettings } from "@/lib/ai-chat/types";

const storageMocks = vi.hoisted(() => ({
  deleteSkill: vi.fn(),
  loadSkills: vi.fn(),
  openSkillsFolder: vi.fn(),
  saveSkill: vi.fn(),
}));

vi.mock("@/lib/ai-chat/storage", () => storageMocks);

function createSkill(
  overrides: Partial<LoadedSkillInfo> = {},
): LoadedSkillInfo {
  return {
    name: "docs",
    enabled: true,
    description: "Docs helper",
    instructions: "Use the docs.",
    recommendedToolNames: [],
    directoryPath: "/skills/docs",
    manifestPath: "/skills/docs/SKILL.md",
    manifestContent:
      "---\nname: docs\ndescription: Docs helper\n---\n\nUse the docs.",
    sourceKind: "global",
    sourcePath: "/skills",
    fileTree: [{ name: "SKILL.md", type: "file" }],
    ...overrides,
  };
}

function createSettings(): SkillsSettings {
  return {
    enabled: true,
    skillsPermission: "custom",
    skillPermissions: {},
    permissionModelVersion: 2,
  };
}

function renderSkillsDialog(
  initialSkills: LoadedSkillInfo[] = [createSkill()],
) {
  const showSuccess = vi.fn();
  const showError = vi.fn();

  storageMocks.loadSkills.mockResolvedValue(initialSkills);

  function Harness() {
    const [open, setOpen] = useState(true);
    const [settings, setSettings] = useState(createSettings());
    const [skills, setSkills] = useState(initialSkills);

    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open skills
        </button>
        <SkillsDialog
          open={open}
          onOpenChange={setOpen}
          skillsSettings={settings}
          onSkillsSettingsChange={setSettings}
          loadedSkills={skills}
          onLoadedSkillsChange={setSkills}
          availableTools={[]}
          workspaceRoots={[]}
          showSuccess={showSuccess}
          showError={showError}
        />
      </>
    );
  }

  return {
    user: userEvent.setup(),
    showSuccess,
    showError,
    ...render(<Harness />),
  };
}

describe("SkillsDialog", () => {
  beforeEach(() => {
    storageMocks.loadSkills.mockResolvedValue([createSkill()]);
    storageMocks.deleteSkill.mockReset();
    storageMocks.openSkillsFolder.mockReset();
    storageMocks.saveSkill.mockReset();
  });

  it("derives disabled name and description fields from SKILL.md", async () => {
    const { user } = renderSkillsDialog();

    const nameInput = await screen.findByLabelText("Name");
    const descriptionInput = screen.getByLabelText("Description");
    const manifestInput = screen.getByLabelText("SKILL.md");

    expect(nameInput).toBeDisabled();
    expect(nameInput).toHaveValue("docs");
    expect(descriptionInput).toBeDisabled();
    expect(descriptionInput).toHaveValue("Docs helper");

    await user.clear(manifestInput);
    await user.type(
      manifestInput,
      "---\nname: docs-v2\ndescription: Updated docs helper\n---\n\nUse the docs.",
    );

    expect(nameInput).toHaveValue("docs-v2");
    expect(descriptionInput).toHaveValue("Updated docs helper");
  });


  it("shows skill-name validation under the derived name input", async () => {
    const { user } = renderSkillsDialog();

    const manifestInput = await screen.findByLabelText("SKILL.md");
    const nameInput = screen.getByLabelText("Name");

    await user.clear(manifestInput);
    await user.type(
      manifestInput,
      "---\nname: invalid skill name\ndescription: Bad name\n---\n\nUse it.",
    );

    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Use 1–64 letters, numbers, underscores, or hyphens."),
    ).toBeInTheDocument();
  });

  it("clears the skills search query from the inline clear button", async () => {
    const { user } = renderSkillsDialog([
      createSkill(),
      createSkill({
        name: "code-review",
        description: "Review code",
        manifestPath: "/skills/code-review/SKILL.md",
        directoryPath: "/skills/code-review",
        manifestContent:
          "---\nname: code-review\ndescription: Review code\n---\n\nReview code.",
      }),
    ]);

    const searchInput = await screen.findByLabelText(
      "Search skills by name or description",
    );

    await user.type(searchInput, "code");
    expect(searchInput).toHaveValue("code");

    await user.click(screen.getByTitle("Clear search"));

    expect(searchInput).toHaveValue("");
  });

  it("discards a new skill draft before closing so reopen shows the existing skill", async () => {
    const { user } = renderSkillsDialog();

    await user.click(
      await screen.findByRole("button", { name: "Create skill" }),
    );
    expect(screen.getByText("New skill")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await user.click(screen.getByRole("button", { name: "Open skills" }));

    expect(screen.queryByText("New skill")).not.toBeInTheDocument();
    expect(screen.getByText("Edit skill")).toBeInTheDocument();
  });
});
