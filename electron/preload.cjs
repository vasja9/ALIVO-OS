const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({
  complete: () => ipcRenderer.invoke("onboarding:complete"),
}));
