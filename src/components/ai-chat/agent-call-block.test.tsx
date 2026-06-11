import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ai-chat/agent-transcript-dialog", () => ({
  AgentTranscriptDialog: () => <div data-testid="agent-transcript-dialog" />,
}));

import { AgentCallBlock } from "@/components/ai-chat/agent-call-block";
import type { ChatAgentCall } from "@/lib/ai-chat/types";

const agentCall: ChatAgentCall = {
  id: "agent-call-1",
  agentName: "General",
  task: "Inspect the project",
  status: "running",
  contextMode: "task_only",
  depth: 0,
  startedAt: "2026-01-01T00:00:00.000Z",
  model: "test-model",
  output: "Hidden live output",
  reasoning: "Hidden live reasoning",
  messages: [],
  childAgentCalls: [],
};

const baseProps = {
  id: "agent-call-1",
  agentCall,
  canSubmitAskUserResponse: vi.fn(() => false),
  onSubmitAskUserResponse: vi.fn(),
  onCancelAskUserRequest: vi.fn(),
};

describe("AgentCallBlock", () => {
  it("does not mount the transcript dialog while closed", () => {
    render(<AgentCallBlock {...baseProps} />);

    expect(screen.queryByTestId("agent-transcript-dialog")).toBeNull();
  });

  it("mounts the transcript dialog when opened", () => {
    render(<AgentCallBlock {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /general/i }));

    expect(screen.getByTestId("agent-transcript-dialog")).toBeInTheDocument();
  });
});
