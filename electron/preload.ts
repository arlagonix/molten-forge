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
    return ipcRenderer.invoke(
      "storage:provider-models-cache:save",
      cacheKey,
      models,
    );
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

  loadSkillsSettings() {
    return ipcRenderer.invoke("storage:skills-settings:load");
  },

  saveSkillsSettings(value: unknown) {
    return ipcRenderer.invoke("storage:skills-settings:save", value);
  },

  loadAgentsSettings() {
    return ipcRenderer.invoke("storage:agents-settings:load");
  },

  saveAgentsSettings(value: unknown) {
    return ipcRenderer.invoke("storage:agents-settings:save", value);
  },

  loadAppSettings() {
    return ipcRenderer.invoke("storage:app-settings:load");
  },

  saveAppSettings(value: unknown) {
    return ipcRenderer.invoke("storage:app-settings:save", value);
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

  importTools() {
    return ipcRenderer.invoke("storage:tools:import");
  },

  exportTool(tool: unknown) {
    return ipcRenderer.invoke("storage:tool:export", tool);
  },

  exportTools(tools: unknown) {
    return ipcRenderer.invoke("storage:tools:export", tools);
  },

  openToolsFolder() {
    return ipcRenderer.invoke("storage:tools:open-folder");
  },

  loadSkills() {
    return ipcRenderer.invoke("storage:skills:load");
  },

  saveSkill(skill: unknown) {
    return ipcRenderer.invoke("storage:skill:save", skill);
  },

  deleteSkill(skillId: unknown) {
    return ipcRenderer.invoke("storage:skill:delete", skillId);
  },

  importSkills() {
    return ipcRenderer.invoke("storage:skills:import");
  },

  exportSkill(skill: unknown) {
    return ipcRenderer.invoke("storage:skill:export", skill);
  },

  exportSkills(skills: unknown) {
    return ipcRenderer.invoke("storage:skills:export", skills);
  },

  openSkillsFolder() {
    return ipcRenderer.invoke("storage:skills:open-folder");
  },

  loadAgents() {
    return ipcRenderer.invoke("storage:agents:load");
  },

  saveAgent(agent: unknown) {
    return ipcRenderer.invoke("storage:agent:save", agent);
  },

  deleteAgent(agentId: unknown) {
    return ipcRenderer.invoke("storage:agent:delete", agentId);
  },

  importAgents() {
    return ipcRenderer.invoke("storage:agents:import");
  },

  exportAgent(agent: unknown) {
    return ipcRenderer.invoke("storage:agent:export", agent);
  },

  exportAgents(agents: unknown) {
    return ipcRenderer.invoke("storage:agents:export", agents);
  },

  openAgentsFolder() {
    return ipcRenderer.invoke("storage:agents:open-folder");
  },
});

contextBridge.exposeInMainWorld("chatForgeWorkspace", {
  selectFolder() {
    return ipcRenderer.invoke("workspace:select-folder");
  },

  openFolder(folderPath: unknown) {
    return ipcRenderer.invoke("workspace:open-folder", folderPath);
  },
});

contextBridge.exposeInMainWorld("chatForgeTools", {
  execute(request: unknown) {
    return ipcRenderer.invoke("tools:execute", request);
  },

  cancel(executionId: unknown) {
    return ipcRenderer.invoke("tools:cancel", executionId);
  },

  test(request: unknown) {
    return ipcRenderer.invoke("tools:test", request);
  },
});

contextBridge.exposeInMainWorld("chatForgeFind", {
  findInPage(request: unknown) {
    return ipcRenderer.invoke("find-in-page:start", request);
  },

  stopFindInPage(action: unknown) {
    return ipcRenderer.invoke("find-in-page:stop", action);
  },

  onFoundInPage(callback: (result: unknown) => void) {
    const listener = (_event: IpcRendererEvent, result: unknown) => {
      callback(result);
    };

    ipcRenderer.on("find-in-page:result", listener);

    return () => {
      ipcRenderer.removeListener("find-in-page:result", listener);
    };
  },
});
