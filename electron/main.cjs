const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { configurePersistentDataPath } = require("./paths.cjs");
const { createRuntimeHost } = require("./runtime-host.cjs");
const { startPinterestOAuth, REDIRECT_URI } = require("./pinterest-oauth.cjs");
const { createPinterestDataCollector } = require("./pinterest-data.cjs");
const { createPinterestPublisher } = require("./pinterest-publisher.cjs");

configurePersistentDataPath(app);
const onboardingFile = () => path.join(app.getPath("userData"), "state", "onboarding.json");
async function isInitialized() { try { const state = JSON.parse(await fs.readFile(onboardingFile(), "utf8")); return state.schemaVersion === 1 && state.completed === true; } catch { return false; } }
ipcMain.handle("onboarding:complete", async () => { const target = onboardingFile(), temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, completed: true, completedAt: new Date().toISOString() }), { mode: 0o600 }); await fs.rename(temporary, target); return true; });

app.whenReady().then(async () => {
  const runtime = createRuntimeHost(app, safeStorage);
  await runtime.initialize();
  const pinterestData = createPinterestDataCollector(() => runtime.getPinterestAccessToken());
  const pinterestPublisher = createPinterestPublisher(() => runtime.getPinterestAccessToken());
  const initialized = await isInitialized();
  const window = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#9c1c31", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } });

  let authWindow;
  async function openAuth(request) {
    const result = await runtime.openAuthentication(request?.integration);
    if (result.state !== "Opened") return result;
    if (authWindow && !authWindow.isDestroyed()) { authWindow.focus(); return result; }
    authWindow = new BrowserWindow({ parent: window, modal: true, width: 720, height: 650, resizable: false, backgroundColor: "#9c1c31", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "auth-preload.cjs") } });
    authWindow.on("closed", () => { authWindow = undefined; window.webContents.send("integration:changed"); });
    await authWindow.loadFile(path.join(__dirname, "../ui/auth.html"), { query: { integration: result.integration } });
    return result;
  }

  ipcMain.handle("runtime:status", () => runtime.status());
  ipcMain.handle("system:integrations", () => runtime.integrations());
  ipcMain.handle("system:open-authentication", (_event, request) => openAuth(request));
  ipcMain.handle("system:command", (_event, request) => runtime.systemCommand(request));
  ipcMain.handle("settings:read", (_event, request) => runtime.settingsRead(request));
  ipcMain.handle("settings:command", (_event, request) => runtime.settingsCommand(request));
  ipcMain.handle("settings:open-authentication", (_event, request) => openAuth(request));
  ipcMain.handle("auth:verify", (_event, request) => runtime.verifyAuthentication(request));
  ipcMain.handle("auth:pinterest-oauth-info", () => ({ redirectUri: REDIRECT_URI }));
  ipcMain.handle("auth:pinterest-oauth", async (_event, request = {}) => {
    const appId = String(request.appId || "").trim();
    const appSecret = String(request.appSecret || "").trim();
    if (!appId || !appSecret) return { state: "Configuration Invalid", message: "Pinterest App ID and App secret are required." };
    const result = await startPinterestOAuth({
      appId,
      appSecret,
      openExternal: (url) => shell.openExternal(url),
      complete: (payload) => runtime.completePinterestOAuth(payload),
    });
    window.webContents.send("integration:changed");
    return result;
  });
  ipcMain.handle("pinterest:data", () => pinterestData.snapshot());
  ipcMain.handle("pinterest:publish-test", async (_event, request) => {
    const result = await pinterestPublisher.create(request);
    if (result?.state === "Published") window.webContents.send("pinterest:data-changed");
    return result;
  });
  ipcMain.on("auth:close", () => { if (authWindow && !authWindow.isDestroyed()) authWindow.close(); });

  await window.loadFile(path.join(__dirname, `../ui/${initialized ? "index.html" : "onboarding.html"}`));
  if (initialized) {
    const integrationProjection = await fs.readFile(path.join(__dirname, "../ui/integration-runtime.js"), "utf8");
    await window.webContents.executeJavaScript(integrationProjection);
    const pinterestProjection = await fs.readFile(path.join(__dirname, "../ui/pinterest-runtime.js"), "utf8");
    await window.webContents.executeJavaScript(pinterestProjection);
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

  runtime.maintainPinterestOAuth(false).then(result => {
    if (result?.refreshed) window.webContents.send("integration:changed");
  }).catch(() => {});
  const oauthMaintenance = setInterval(() => {
    runtime.maintainPinterestOAuth(false).then(result => {
      if (result?.refreshed) window.webContents.send("integration:changed");
    }).catch(() => {});
  }, 6 * 60 * 60 * 1000);
  oauthMaintenance.unref?.();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
