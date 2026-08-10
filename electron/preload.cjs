const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alivoOnboarding", Object.freeze({
  complete: () => ipcRenderer.invoke("onboarding:complete"),
}));

contextBridge.exposeInMainWorld("alivoRuntime", Object.freeze({
  status: () => ipcRenderer.invoke("runtime:status"),
}));

contextBridge.exposeInMainWorld("alivoSystem", Object.freeze({
  integrations: () => ipcRenderer.invoke("system:integrations"),
  openAuthentication: async (request) => {
    const result = await ipcRenderer.invoke("system:open-authentication", request);
    if (result?.route) {
      window.dispatchEvent(new CustomEvent("alivo:navigate", { detail: { destination: "Settings", route: result.route } }));
      window.dispatchEvent(new CustomEvent("alivo:settings:open"));
    }
    return result;
  },
}));
