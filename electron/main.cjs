const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { configurePersistentDataPath } = require("./paths.cjs");

configurePersistentDataPath(app);
const onboardingFile = () => path.join(app.getPath("userData"), "state", "onboarding.json");
async function isInitialized() { try { const state = JSON.parse(await fs.readFile(onboardingFile(), "utf8")); return state.schemaVersion === 1 && state.completed === true; } catch { return false; } }
ipcMain.handle("onboarding:complete", async () => { const target = onboardingFile(), temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, completed: true, completedAt: new Date().toISOString() }), { mode: 0o600 }); await fs.rename(temporary, target); return true; });
app.whenReady().then(async () => {
  const initialized = await isInitialized();
  const window = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#9c1c31", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } });
  await window.loadFile(path.join(__dirname, `../ui/${initialized ? "index.html" : "onboarding.html"}`));
  if (initialized) {
    await window.webContents.insertCSS(`
      [hidden] { display: none !important; }
      :root { --bg: rgb(156, 28, 49); --panel: #7f182b; --panel2: #8f1a30; --line: rgba(255,255,255,.24); --text: #fffaf7; --muted: #f1dfe2; }
      body { background: rgb(156, 28, 49) !important; color: var(--text); }
      header, aside, footer { background: rgba(92, 10, 29, .82) !important; }
      .card, .kpi { background: rgba(93, 13, 31, .48) !important; border-color: rgba(255,255,255,.24) !important; }
      nav button { color: #f5e8ea !important; }
      nav button.selected { background: rgba(76, 8, 24, .58) !important; color: #fff4d2 !important; }
      .kpi span, .metric span, small, .quiet, .freshness, .sidebar-footer small { color: #f1dfe2 !important; }
      .chart, .data-table, .view-tabs, .periods, input, select { background: rgba(78, 8, 25, .38) !important; }
    `);
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
