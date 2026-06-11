import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttachmentChips } from "@/components/ai-chat/attachment-chips";
import type { ChatAttachment } from "@/lib/ai-chat/types";

const baseAttachment: ChatAttachment = {
  id: "attachment-1",
  name: "vitest.config.ts",
  kind: "text",
  mimeType: "text/typescript",
  sizeBytes: 2048,
  storagePath: "C:\\Users\\Acer\\Projects\\vitest.config.ts",
  storageMode: "temporary",
  temporary: true,
  available: true,
  tokenEstimate: 8,
};

describe("AttachmentChips", () => {
  it("does not expose temporary storage state in the chip UI", () => {
    render(<AttachmentChips attachments={[baseAttachment]} />);

    expect(screen.getByText("vitest.config.ts")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.queryByText("temp")).not.toBeInTheDocument();
  });

  it("keeps file icon and size visible on user-message primary surfaces", () => {
    const { container } = render(
      <AttachmentChips
        attachments={[baseAttachment]}
        readOnly
        tone="onPrimary"
      />,
    );

    expect(screen.getByText("2 KB")).toHaveClass("text-primary-foreground/75");
    expect(container.querySelector(".lucide-file-code")).toHaveClass(
      "text-primary-foreground/75",
    );
  });
});
