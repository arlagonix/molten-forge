import { describe, expect, it } from "vitest";
import {
  assistantErrorMessage,
  historyAssistantErrorMessage,
  isAssistantAbortTerminal,
  isProviderAbortMessage,
  isSupersededAssistantError,
  shouldSurfacePendingAssistantError,
} from "./pi-assistant-errors";

describe("assistantErrorMessage", () => {
  it("returns Pi's finalized assistant error text", () => {
    expect(assistantErrorMessage({
      role: "assistant",
      stopReason: "error",
      errorMessage: "401: Authentication Fails",
      content: [],
    })).toBe("401: Authentication Fails");
  });

  it("uses a stable fallback when Pi omits errorMessage", () => {
    expect(assistantErrorMessage({ role: "assistant", stopReason: "error", content: [] }))
      .toBe("Assistant request failed.");
  });

  it("surfaces Pi output-token truncation with the native TUI wording", () => {
    expect(assistantErrorMessage({ role: "assistant", stopReason: "length", content: [] }))
      .toBe("Response was truncated before completion.");
  });

  it("does not turn successful or explicitly aborted messages into errors", () => {
    expect(assistantErrorMessage({ role: "assistant", stopReason: "stop", errorMessage: "ignored" })).toBeNull();
    expect(assistantErrorMessage({ role: "assistant", stopReason: "aborted", errorMessage: "This operation was aborted" })).toBeNull();
    expect(assistantErrorMessage({ role: "user", stopReason: "error", errorMessage: "ignored" })).toBeNull();
  });
});

describe("provider abort detection", () => {
  it("recognizes provider finish_reason abort errors as terminal interruption", () => {
    const message = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "Provider finish_reason: abort",
    };
    expect(isProviderAbortMessage(message)).toBe(true);
    expect(isAssistantAbortTerminal(message)).toBe(true);
    expect(assistantErrorMessage(message)).toBe("Provider finish_reason: abort");
  });

  it("keeps explicit user aborts non-error but still terminal for live runtime chrome", () => {
    const message = { role: "assistant", stopReason: "aborted", errorMessage: "This operation was aborted" };
    expect(isProviderAbortMessage(message)).toBe(false);
    expect(isAssistantAbortTerminal(message)).toBe(true);
    expect(assistantErrorMessage(message)).toBeNull();
  });

  it("does not confuse ordinary provider errors with abort", () => {
    expect(isProviderAbortMessage({
      role: "assistant",
      stopReason: "error",
      errorMessage: "Provider finish_reason: length",
    })).toBe(false);
  });
});

describe("historyAssistantErrorMessage", () => {
  const failed = (message: string) => ({
    role: "assistant",
    stopReason: "error",
    errorMessage: message,
    content: [],
  });

  it("keeps a terminal provider failure at the end of a user turn", () => {
    const messages = [
      { role: "user", content: "hello" },
      failed("401: invalid API key"),
    ];

    expect(historyAssistantErrorMessage(messages, 1)).toBe("401: invalid API key");
    expect(isSupersededAssistantError(messages, 1)).toBe(false);
  });

  it("suppresses failed retry attempts when a later assistant response exists before the next user", () => {
    const messages = [
      { role: "user", content: "hello" },
      failed("529: overloaded"),
      failed("529: overloaded again"),
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recovered" }] },
    ];

    expect(historyAssistantErrorMessage(messages, 1)).toBeNull();
    expect(historyAssistantErrorMessage(messages, 2)).toBeNull();
  });

  it("keeps the final failed retry while suppressing earlier failed attempts", () => {
    const messages = [
      { role: "user", content: "hello" },
      failed("attempt one"),
      failed("attempt two"),
    ];

    expect(historyAssistantErrorMessage(messages, 1)).toBeNull();
    expect(historyAssistantErrorMessage(messages, 2)).toBe("attempt two");
  });

  it("does not treat an assistant response after the next user message as the same retry chain", () => {
    const messages = [
      { role: "user", content: "first" },
      failed("terminal first-turn failure"),
      { role: "user", content: "second" },
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] },
    ];

    expect(historyAssistantErrorMessage(messages, 1)).toBe("terminal first-turn failure");
  });
  it("restores a terminal length-truncation notice", () => {
    const messages = [
      { role: "user", content: "write a long answer" },
      { role: "assistant", stopReason: "length", content: [{ type: "text", text: "partial" }] },
    ];

    expect(historyAssistantErrorMessage(messages, 1))
      .toBe("Response was truncated before completion.");
  });

});

describe("shouldSurfacePendingAssistantError", () => {
  it("surfaces a non-retryable terminal error", () => {
    expect(shouldSurfacePendingAssistantError({
      retryActivityActive: false,
      interruptInFlight: false,
    })).toBe(true);
  });

  it("defers to final retry UI and explicit Stop", () => {
    expect(shouldSurfacePendingAssistantError({
      retryActivityActive: true,
      interruptInFlight: false,
    })).toBe(false);
    expect(shouldSurfacePendingAssistantError({
      retryActivityActive: false,
      interruptInFlight: true,
    })).toBe(false);
  });
});
