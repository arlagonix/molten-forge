import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

contextBridge.exposeInMainWorld("codeForgeAI", {
  loadModels(request: unknown) {
    return ipcRenderer.invoke("ai:load-models", request);
  },

  sendChat(request: unknown) {
    return ipcRenderer.invoke("ai:send-chat", request);
  },

  streamChat(request: unknown) {
    const streamId = createId();

    return {
      id: streamId,
      cancel() {
        void ipcRenderer.invoke("ai:cancel-stream", streamId);
      },
      result(onDelta: (event: unknown) => void) {
        const channel = `ai:stream-delta:${streamId}`;
        const listener = (_event: IpcRendererEvent, payload: unknown) => {
          onDelta(payload);
        };

        ipcRenderer.on(channel, listener);

        return ipcRenderer
          .invoke("ai:stream-chat", streamId, request)
          .finally(() => {
            setTimeout(() => {
              ipcRenderer.removeListener(channel, listener);
            }, 0);
          });
      },
    };
  },
});

contextBridge.exposeInMainWorld("chatForgeStorage", {
  isInitialized() {
    return ipcRenderer.invoke("storage:is-initialized");
  },

  migrateFromIndexedDb(snapshot: unknown) {
    return ipcRenderer.invoke("storage:migrate-from-indexeddb", snapshot);
  },

  loadProvidersState() {
    return ipcRenderer.invoke("storage:providers-state:load");
  },

  saveProvidersState(value: unknown) {
    return ipcRenderer.invoke("storage:providers-state:save", value);
  },

  loadSystemPrompt() {
    return ipcRenderer.invoke("storage:system-prompt:load");
  },

  saveSystemPrompt(value: unknown) {
    return ipcRenderer.invoke("storage:system-prompt:save", value);
  },

  loadActiveChatId() {
    return ipcRenderer.invoke("storage:active-chat-id:load");
  },

  saveActiveChatId(chatId: unknown) {
    return ipcRenderer.invoke("storage:active-chat-id:save", chatId);
  },

  loadCachedProviderModels(cacheKey: unknown) {
    return ipcRenderer.invoke("storage:provider-models-cache:load", cacheKey);
  },

  saveCachedProviderModels(cacheKey: unknown, models: unknown) {
    return ipcRenderer.invoke("storage:provider-models-cache:save", cacheKey, models);
  },

  loadChats() {
    return ipcRenderer.invoke("storage:chats:load");
  },

  saveChat(chat: unknown) {
    return ipcRenderer.invoke("storage:chat:save", chat);
  },

  deleteChat(chatId: unknown) {
    return ipcRenderer.invoke("storage:chat:delete", chatId);
  },

  deleteAllChats() {
    return ipcRenderer.invoke("storage:chats:delete-all");
  },

  loadToolsSettings() {
    return ipcRenderer.invoke("storage:tools-settings:load");
  },

  saveToolsSettings(value: unknown) {
    return ipcRenderer.invoke("storage:tools-settings:save", value);
  },

  loadTools() {
    return ipcRenderer.invoke("storage:tools:load");
  },

  saveTool(tool: unknown) {
    return ipcRenderer.invoke("storage:tool:save", tool);
  },

  deleteTool(toolId: unknown) {
    return ipcRenderer.invoke("storage:tool:delete", toolId);
  },
});


contextBridge.exposeInMainWorld("chatForgeTools", {
  execute(request: unknown) {
    return ipcRenderer.invoke("tools:execute", request);
  },

  test(request: unknown) {
    return ipcRenderer.invoke("tools:test", request);
  },
});
