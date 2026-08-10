const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("alivoAuth", Object.freeze({
  verify: (request) => ipcRenderer.invoke("auth:verify", request),
  pinterestOAuthInfo: () => ipcRenderer.invoke("auth:pinterest-oauth-info"),
  pinterestOAuth: (request) => ipcRenderer.invoke("auth:pinterest-oauth", request),
  close: () => ipcRenderer.send("auth:close"),
}));
