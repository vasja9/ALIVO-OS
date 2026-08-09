const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const onboardingFile = () => path.join(app.getPath("userData"), "state", "onboarding.json");
async function isInitialized() { try { const state = JSON.parse(await fs.readFile(onboardingFile(), "utf8")); return state.schemaVersion === 1 && state.completed === true; } catch { return false; } }
ipcMain.handle("onboarding:complete", async () => { const target = onboardingFile(), temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, completed: true, completedAt: new Date().toISOString() }), { mode: 0o600 }); await fs.rename(temporary, target); return true; });
app.whenReady().then(async () => { const window = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#091016", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } }); window.loadFile(path.join(__dirname, `../ui/${await isInitialized() ? "index.html" : "onboarding.html"}`)); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
