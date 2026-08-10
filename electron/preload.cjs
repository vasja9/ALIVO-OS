const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({
  complete: () => ipcRenderer.invoke("onboarding:complete"),
}));

contextBridge.exposeInMainWorld("alivoRuntime", Object.freeze({
  status: () => ipcRenderer.invoke("runtime:status"),
}));

contextBridge.exposeInMainWorld("alivoSystem", Object.freeze({
  integrations: () => ipcRenderer.invoke("system:integrations"),
  openAuthentication: (request) => ipcRenderer.invoke("system:open-authentication", request),
}));
