const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("alivoAuth", Object.freeze({
  verify: (request) => ipcRenderer.invoke("auth:verify", request),
  close: () => ipcRenderer.send("auth:close"),
}));
