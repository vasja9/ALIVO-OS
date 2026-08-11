const { contextBridge, ipcRenderer } = require("electron");
const navigateToSettings = (result) => { if (result?.route) { window.dispatchEvent(new CustomEvent("alivo:navigate", { detail: { destination: "Settings", route: result.route } })); window.dispatchEvent(new CustomEvent("alivo:settings:open")); } return result; };
contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({ complete: () => ipcRenderer.invoke("onboarding:complete") }));
contextBridge.exposeInMainWorld("alivoRuntime", Object.freeze({ status: () => ipcRenderer.invoke("runtime:status") }));
contextBridge.exposeInMainWorld("alivoSystem", Object.freeze({ integrations: () => ipcRenderer.invoke("system:integrations"), openAuthentication: async (request) => navigateToSettings(await ipcRenderer.invoke("system:open-authentication", request)), command: (request) => ipcRenderer.invoke("system:command", request), onIntegrationChanged: (listener) => { if (typeof listener !== "function") return () => {}; const handler = () => listener(); ipcRenderer.on("integration:changed", handler); return () => ipcRenderer.removeListener("integration:changed", handler); } }));
contextBridge.exposeInMainWorld("alivoSettings", Object.freeze({ read: (request) => ipcRenderer.invoke("settings:read", request), command: (request) => ipcRenderer.invoke("settings:command", request), openAuthentication: async (request) => navigateToSettings(await ipcRenderer.invoke("settings:open-authentication", request)) }));
contextBridge.exposeInMainWorld("alivoPinterest", Object.freeze({
  read: (request) => ipcRenderer.invoke("pinterest:workspace", request), readLive: () => ipcRenderer.invoke("pinterest:data"), publisherCapabilities: () => ipcRenderer.invoke("pinterest:publisher-capabilities"), publishTestPin: (request) => ipcRenderer.invoke("pinterest:publish-test", request), publishProductionPin: (request) => ipcRenderer.invoke("pinterest:publish-production", request),
  scheduler: Object.freeze({
    list: () => ipcRenderer.invoke("pinterest:scheduler:list"),
    nextSlot: (from) => ipcRenderer.invoke("pinterest:scheduler:next-slot", from),
    schedule: (request) => ipcRenderer.invoke("pinterest:scheduler:schedule", request),
    reschedule: (request) => ipcRenderer.invoke("pinterest:scheduler:reschedule", request),
    cancel: (jobId) => ipcRenderer.invoke("pinterest:scheduler:cancel", jobId),
    enable: (enabled) => ipcRenderer.invoke("pinterest:scheduler:enable", enabled),
    setCadence: (minutes) => ipcRenderer.invoke("pinterest:scheduler:set-cadence", minutes),
    runDue: () => ipcRenderer.invoke("pinterest:scheduler:run-due"),
    onChanged: (listener) => { if (typeof listener !== "function") return () => {}; const handler = () => listener(); ipcRenderer.on("pinterest:scheduler-changed", handler); return () => ipcRenderer.removeListener("pinterest:scheduler-changed", handler); },
  }),
}));
