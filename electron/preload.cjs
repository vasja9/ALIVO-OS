const { contextBridge, ipcRenderer } = require("electron");

const navigateToSettings = (result) => {
  if (result?.route) {
    window.dispatchEvent(new CustomEvent("alivo:navigate", { detail: { destination: "Settings", route: result.route } }));
    window.dispatchEvent(new CustomEvent("alivo:settings:open"));
  }
  return result;
};

contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({
  complete: () => ipcRenderer.invoke("onboarding:complete"),
}));

contextBridge.exposeInMainWorld("alivoRuntime", Object.freeze({
  status: () => ipcRenderer.invoke("runtime:status"),
}));

contextBridge.exposeInMainWorld("alivoSystem", Object.freeze({
  integrations: () => ipcRenderer.invoke("system:integrations"),
  openAuthentication: async (request) => navigateToSettings(await ipcRenderer.invoke("system:open-authentication", request)),
  command: (request) => ipcRenderer.invoke("system:command", request),
}));

contextBridge.exposeInMainWorld("alivoSettings", Object.freeze({
  read: (request) => ipcRenderer.invoke("settings:read", request),
  command: (request) => ipcRenderer.invoke("settings:command", request),
  openAuthentication: async (request) => navigateToSettings(await ipcRenderer.invoke("settings:open-authentication", request)),
}));
