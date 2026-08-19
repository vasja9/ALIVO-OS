const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({
  complete: () => ipcRenderer.invoke("onboarding:complete"),
}));
contextBridge.exposeInMainWorld("alivoPinterest", Object.freeze({
  startOAuth: (request) => ipcRenderer.invoke("pinterest:oauth:start", request),
  connectionStatus: (credentialId) => ipcRenderer.invoke("pinterest:connection:status", credentialId),
  verifyConnection: (request) => ipcRenderer.invoke("pinterest:connection:verify", request),
  readObservation: (request) => ipcRenderer.invoke("pinterest:observation:read", request),
}));
contextBridge.exposeInMainWorld("alivoPinterestLocalConfig", Object.freeze({
  status: () => ipcRenderer.invoke("pinterest:local-config:status"),
  save: (request) => ipcRenderer.invoke("pinterest:local-config:save", request),
  clear: () => ipcRenderer.invoke("pinterest:local-config:clear"),
}));
