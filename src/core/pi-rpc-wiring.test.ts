import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
const rust = readFileSync(fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)), "utf8");

describe("Pi RPC boundary contracts", () => {
  it("dispatches Pi records through the latest render instead of a stale listener closure", () => {
    expect(app).toContain("handleRecordRef.current = handleRecord");

    // Records reach the latest handler through the delta coalescer, which reads
    // handleRecordRef at flush time rather than capturing a first-render closure.
    expect(app).toContain("createPiDeltaCoalescer((record) => handleRecordRef.current(record))");
    const listenerStart = app.indexOf('listen<string>("pi-record"');
    expect(listenerStart).toBeGreaterThan(0);
    const listenerBlock = app.slice(listenerStart, app.indexOf("]);", listenerStart));
    expect(listenerBlock).toContain("piDeltas.push(JSON.parse(event.payload))");
    expect(listenerBlock).not.toContain("handleRecord(");
  });
  it("does not expose the UI as connected before the RPC readiness barrier", () => {
    expect(app).toContain("Process existence is not RPC readiness");

    const syncStart = app.indexOf("async function startPiAndSync");
    const connectStart = app.indexOf("async function connect(", syncStart);
    const syncBlock = app.slice(syncStart, connectStart);
    const ready = syncBlock.indexOf('type: "get_state"');
    const connectBlockEnd = app.indexOf("async function abortDirectBash", connectStart);
    const connectBlock = app.slice(connectStart, connectBlockEnd);
    const startAndSync = connectBlock.indexOf("await startPiAndSync(workingDirectory, true)");
    const connected = connectBlock.indexOf("setConnected(true)");

    expect(syncStart).toBeGreaterThan(0);
    expect(connectStart).toBeGreaterThan(syncStart);
    expect(ready).toBeGreaterThan(0);
    expect(syncBlock).not.toContain("setConnected(true)");
    expect(startAndSync).toBeGreaterThan(0);
    expect(connected).toBeGreaterThan(startAndSync);
  });
  it("does not treat compaction_end as a whole-run idle boundary", () => {
    const start = app.indexOf('case "compaction_end"');
    const end = app.indexOf('case "auto_compaction_start"', start);
    const block = app.slice(start, end);
    expect(block).not.toContain("setStreamingState(false)");
    expect(block).toContain('{ type: "get_state" }');
  });
  it("reads Pi stdout as LF-delimited records and tolerates CRLF", () => {
    expect(rust).toContain("reader.read_until(b'\\n'");
    expect(rust).toContain("bytes.last() == Some(&b'\\r')");
  });
  it("correlates request ids instead of treating stdin write as completion", () => {
    expect(app).toContain("pendingRpcResponses");
    expect(app).toContain("sendRecordAndWait");
    expect(app).toContain("pendingResponse.resolve(record)");
  });
  it("stops like Pi Escape: clear queue before abort", () => {
    const clear = app.indexOf('{ type: "clear_queue" }');
    const abort = app.indexOf('{ type: "abort" }', clear);
    expect(clear).toBeGreaterThan(0);
    expect(abort).toBeGreaterThan(clear);
  });
  it("waits for idle state and resynchronizes persisted messages after abort", () => {
    expect(app).toContain("runtimeStateAfterInterrupt");
    expect(app).toContain("unmatchedToolCallIds(messagesResponse.data?.messages)");
  });
  it("keeps Stop pending through compaction and only restarts Pi after a long stall", () => {
    expect(app).toContain('setGenerationStatus("Stopping compaction…")');
    expect(app).toContain("INTERRUPT_COMPACTION_RESTART_TIMEOUT_MS");
    expect(app).toContain('rejectPendingRpcResponses("Pi restarted to stop stalled compaction.")');
    expect(app).toContain("interruptCompactionAbortReassertedRef");
    expect(app).toContain('Could not reassert Stop after compaction ended');
  });
  it("automatically forks away from a dangling interrupted tool call", () => {
    expect(app).toContain('{ type: "get_fork_messages" }');
    expect(app).toContain('type: "fork", entryId: candidate.entryId');
    expect(app).toContain("mergeRecoveredPrompt");
  });
  it("does not leak Pi stderr into the chat transcript", () => {
    expect(app).toContain('console.warn("[Pi stderr]"');
    expect(app).not.toContain('title: "Pi stderr"');
  });
  it("synchronizes session mutations from Pi after switching", () => {
    expect(app).toContain("switchSessionAndResync");
    expect(app).toContain("resyncActiveSession(true)");
  });
  it("preserves the active session across Pi reload", () => {
    expect(app).toContain("sessionToRestore");
    expect(app).toContain("await switchSessionAndResync(sessionToRestore)");
  });
  it("treats extension_ui_response as a one-way sub-protocol reply", () => {
    expect(app).toContain('sendRecord({ type: "extension_ui_response", id: dialog.id');
    expect(app).not.toContain('sendRecordAndWait({ type: "extension_ui_response"');
  });
  it("renders extension notifications outside transcript history", () => {
    expect(app).toContain("setExtensionNotice");
    expect(app).toContain('className={`extension-notice ${extensionNotice.kind}`}');
    expect(app).not.toContain('title: "Extension", text: record.message');
  });
  it("clears a timed-out extension dialog when Pi emits ui_prompt_end", () => {
    expect(app).toMatch(/case "ui_prompt_end":[\s\S]*?setExtensionDialog\(null\)[\s\S]*?setDialogValue\(""\)/);
  });
  it("renders extension widgets outside transcript messages", () => {
    expect(app).toContain("normalizeExtensionWidget(record)");
    expect(app).toContain('className="extension-widget"');
    expect(app).not.toContain('title: record.widgetKey ?? "Extension widget"');
  });
  it("treats provider finish_reason abort as terminal runtime interruption and resynchronizes before idle", () => {
    expect(app).toContain("isProviderAbortMessage(record.message)");
    expect(app).toContain("isAssistantAbortTerminal(record.message)");
    expect(app).toContain("markRunningRuntimeInterrupted()");
    expect(app).toContain("providerAbortPendingRef.current = providerAbort");
    expect(app).toContain("reconcileProviderAbortAfterSettlement");
    expect(app).toContain("requestHistorySnapshotRaw(HISTORY_SYNC_TIMEOUT_MS)");
    expect(app).toContain('setGenerationStatus("Synchronizing interrupted turn")');
    expect(app).toContain("unmatchedToolCallIds(messagesResponse.data?.messages)");
  });

  it("uses Preparing tool while Pi is still constructing tool arguments", () => {
    const updateStart = app.indexOf('case "message_update"');
    const updateEnd = app.indexOf('case "message_end"', updateStart);
    const block = app.slice(updateStart, updateEnd);
    expect(block).toMatch(/toolcall_start[\s\S]*?setGenerationStatus\("Preparing tool"\)/);
    expect(block).toMatch(/toolcall_delta[\s\S]*?setGenerationStatus\("Preparing tool"\)/);
    expect(block).toMatch(/toolcall_end[\s\S]*?setGenerationStatus\("Preparing tool"\)/);
  });

  it("finishes interrupted Thinking without an interruption badge and renders tools with an X", () => {
    expect(app).not.toContain('title="Interrupted" aria-label="Interrupted"');
    expect(app).toContain('title={item.state === "interrupted" ? "Interrupted" : undefined}');
    expect(app).toContain('className={`tool-state ${item.state ?? "done"}`}');
    expect(app).not.toContain('item.state === "interrupted" ? "error"');
    expect(app).toContain('item.state === "error" || item.state === "interrupted"');
    expect(app).toContain('? <X size={14} />');
  });

  it("keeps interruption visually distinct from execution failure", () => {
    expect(app).toContain('state: record.data?.cancelled');
    expect(app).toContain('? "interrupted"');
    expect(app).toMatch(/tool_execution_end[\s\S]*?item\.state === "interrupted"[\s\S]*?"interrupted"[\s\S]*?record\.isError/);
    expect(app).toMatch(/message\.role === "bashExecution"[\s\S]*?message\.cancelled[\s\S]*?"interrupted"/);
  });

  it("supports abort_bash and blocks prompt submission during direct bash", () => {
    expect(app).toContain('{ type: "abort_bash" }');
    expect(app).toContain("directBashRunningRef.current");
  });
  it("closes Pi stdin before using force termination fallback", () => {
    expect(rust).toContain("self.close_stdin();");
    expect(rust).toContain("wait_for_child_exit");
    expect(rust).toContain("terminate_child(&mut self.child)");
  });
  it("keeps RPC framing as one LF-delimited JSON object", () => {
    expect(rust).toContain('stdin.write_all(b"\\n")');
    expect(rust).toContain("stdin.flush()");
  });
  it("loads the bundled Molten Forge diff extension into Pi RPC", () => {
    expect(rust).toContain("MOLTEN_FORGE_DIFF_EXTENSION_SOURCE");
    expect(rust).toContain("materialize_molten_forge_diff_extension()");
    expect(rust).toContain('command.args(["--mode", "rpc"]);');
    expect(rust).toContain('command.arg("-e");');
    expect(rust).toContain("command.arg(extension_path);");
  });
  it("passes the Windows Pi extension path as a real process argument instead of cmd.exe shell text", () => {
    expect(rust).toContain("fn windows_pi_program() -> PathBuf");
    expect(rust).toContain('Command::new(windows_pi_program())');
    expect(rust).not.toContain('format!(r#"pi --mode rpc');
    expect(rust).not.toContain('command_line.push_str(&format!(r#" -e');
  });
  it("retries Pi startup without the optional diff extension after an early extension failure", () => {
    expect(app).toContain("await startPiAndSync(workingDirectory, true)");
    expect(app).toContain("await startPiAndSync(workingDirectory, false)");
    expect(app).toContain("Retrying Pi without the optional diff extension.");
    expect(app).toContain("File diff preview disabled");
  });
  it("ignores stale process-exit events from the Pi instance replaced during startup fallback", () => {
    expect(rust).toContain('json!({ "state": "exited", "pid": pid })');
    expect(rust).toContain('json!({ "state": "stopped", "pid": pid })');
    expect(app).toContain("activePiPidRef");
    expect(app).toContain("eventPid !== activePiPidRef.current");
    expect(app).toContain("activePiPidRef.current = startResult.pid");
  });
  it("keeps structured file diffs from live tool results and restored history", () => {
    expect(app).toContain("toolDiffFromResult");
    expect(app).toContain("message.details");
    expect(app).toContain("record.result?.details");
    expect(app).toContain("<ToolDiffViewer diff={item.toolDiff!} />");
    expect(app).toContain("<ToolWriteContentViewer");
    expect(app).toContain("writeContentFromArgs");
  });


  it("buffers finalized assistant failures until the whole Pi run settles", () => {
    const messageEndStart = app.indexOf('case "message_end"');
    const messageEndEnd = app.indexOf('case "tool_execution_start"', messageEndStart);
    const messageEnd = app.slice(messageEndStart, messageEndEnd);
    expect(messageEnd).toContain("pendingAssistantErrorRef.current = assistantErrorMessage(record.message)");

    const agentEndStart = app.indexOf('case "agent_end"');
    const agentEndEnd = app.indexOf('case "auto_retry_start"', agentEndStart);
    const agentEnd = app.slice(agentEndStart, agentEndEnd);
    expect(agentEnd).toContain("Boolean(record.willRetry)");
    expect(agentEnd).toContain("pendingAssistantErrorRef.current = null");
    expect(agentEnd).not.toContain("surfacePendingAssistantError");

    const settledStart = app.indexOf('case "agent_settled"');
    const settledEnd = app.indexOf('case "message_start"', settledStart);
    const settled = app.slice(settledStart, settledEnd);
    expect(settled).toContain("surfacePendingAssistantError");
    expect(settled).toContain("interruptInFlightRef.current");
  });

  it("lets retry lifecycle own retry failures instead of duplicating them as terminal error rows", () => {
    const retryStart = app.slice(
      app.indexOf('case "auto_retry_start"'),
      app.indexOf('case "summarization_retry_scheduled"'),
    );
    expect(retryStart).toContain("pendingAssistantErrorRef.current = null");
    expect(retryStart).toContain("activeRetryId.current");
    expect(retryStart).toContain("Retry failed");
  });

  it("refreshes context usage at Pi turn boundaries instead of polling every token delta", () => {
    const turnEnd = app.indexOf('case "turn_end"');
    expect(turnEnd).toBeGreaterThan(0);
    expect(app.slice(turnEnd, app.indexOf('case "agent_start"', turnEnd))).toContain("scheduleLiveContextRefresh()");
    const messageUpdate = app.slice(app.indexOf('case "message_update"'), app.indexOf('case "message_end"'));
    expect(messageUpdate).not.toContain("get_session_stats");
  });
  it("preserves Pi's post-compaction estimate while exact context usage is temporarily null", () => {
    expect(app).toContain("contextEstimateAfterCompaction(result)");
    expect(app).toContain("setPostCompactionContextEstimate(estimate)");
    expect(app).toContain("resolveContextUsage(contextUsage, currentModel?.contextWindow, postCompactionContextEstimate)");
  });
  it("re-arms forced bottom follow for slash commands and direct bash", () => {
    const slashStart = app.indexOf("async function runSlashCommand");
    const slashBody = app.slice(slashStart, app.indexOf("async function answerExtensionDialog", slashStart));
    expect(slashBody).toContain("armExplicitBottomFollow()");
    const bashStart = app.indexOf("async function runDirectBash");
    const bashBody = app.slice(bashStart, app.indexOf("async function submitPrompt", bashStart));
    expect(bashBody).toContain("armExplicitBottomFollow()");
  });
});

describe("managed attachment RPC integration", () => {
  it("sends structured image content to vision models but leaves file paths in Pi session messages", () => {
    expect(app).toContain("composeAttachmentPrompt(raw, attachments)");
    expect(app).toContain('supportsImageInput(currentModel)');
    expect(app).toContain('type: "image" as const');
    expect(app).toContain('data: uint8ToBase64(');
    expect(app).toContain('images } : {}');
    expect(app).toContain('parseAttachmentPrompt(text)');
  });
  it("keeps clipboard, preview, and attachment staging inside memoized composer", () => {
    const composerStart = app.indexOf('const Composer = memo(function Composer(');
    const appStart = app.indexOf('export default function App()');
    const composer = app.slice(composerStart, appStart);
    expect(composer).toContain('const [attachments, setAttachments] = useState');
    expect(composer).toContain('onPaste={(event) =>');
    expect(composer).toContain('onDragDropEvent');
    expect(composer).toContain('stage_attachment_bytes');
    expect(app.slice(appStart)).not.toContain('setAttachments(');
  });
  it("validates managed paths and never exposes arbitrary renderer read paths", () => {
    expect(rust).toContain('validated_managed_path');
    expect(rust).toContain('path.starts_with(root)');
    expect(rust).toContain('file_name: safe_name');
    expect(rust).toContain('discard_attachment,');
  });
});
