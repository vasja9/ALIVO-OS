const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.whenReady().then(() => { const window = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#091016", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } }); window.loadFile(path.join(__dirname, "../ui/index.html")); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
