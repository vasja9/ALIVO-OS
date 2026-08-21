const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { configurePersistentDataPath } = require("./paths.cjs");
const { createPinterestRuntime, readConfiguration } = require("./pinterest-runtime.cjs");
const {
  createPinterestLocalVault,
  defaultPinterestLocalVaultPath,
} = require("./pinterest-local-vault.cjs");
const { assertTrustedPinterestSender, isTrustedUiUrl } = require("./pinterest-ipc-security.cjs");
const { createPinterestContextResolver } = require("./pinterest-context.cjs");
const { createPinterestLifecycle } = require("./pinterest-lifecycle.cjs");
const { createPinterestIpcController } = require("./pinterest-ipc-controller.cjs");

configurePersistentDataPath(app);
const onboardingFile = () => path.join(app.getPath("userData"), "state", "onboarding.json");
async function isInitialized() { try { const state = JSON.parse(await fs.readFile(onboardingFile(), "utf8")); return state.schemaVersion === 1 && state.completed === true; } catch { return false; } }
let pinterestLocalVault;
let pinterestLifecycle;
let pinterestIpcController;
let mainWindow;
const trustedUiPaths = new Set([path.resolve(__dirname, "../ui/index.html"), path.resolve(__dirname, "../ui/onboarding.html")]);
const enablePinterestIpcIntegrationTestFrames = !app.isPackaged && process.env.ALIVO_PINTEREST_ELECTRON_INTEGRATION_TEST === "1";
const pinterestContext = createPinterestContextResolver();
ipcMain.handle("onboarding:complete", async (_event) => { assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths); const target = onboardingFile(), temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, completed: true, completedAt: new Date().toISOString() }), { mode: 0o600 }); await fs.rename(temporary, target); return true; });
function getPinterestLocalVault() {
  if (!pinterestLocalVault) {
    pinterestLocalVault = createPinterestLocalVault({
      filePath: defaultPinterestLocalVaultPath(app.getPath("userData")),
      safeStorage,
    });
  }
  return pinterestLocalVault;
}
async function clearPinterestSessionFile() {
  const sessionFile = path.join(app.getPath("userData"), "state", "pinterest-sessions.enc");
  for (const file of [sessionFile, `${sessionFile}.tmp`]) {
    try {
      await fs.unlink(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
function getPinterestLifecycle() {
  if (!pinterestLifecycle) {
    pinterestLifecycle = createPinterestLifecycle({
      resolveConfiguration: async () => (await getPinterestLocalVault().resolveConfiguration(process.env, !app.isPackaged)) || readConfiguration({}),
      createRuntime: ({ configuration, configurationGeneration, isConfigurationCurrent }) => createPinterestRuntime({
        configuration,
        userDataPath: () => app.getPath("userData"),
        openExternal: (url) => shell.openExternal(url),
        configurationGeneration,
        isConfigurationCurrent,
      }),
      createComposition: (runtime) => {
        const { createPinterestElectronComposition } = require("./generated/integrations/pinterest/PinterestElectronComposition.cjs");
        return createPinterestElectronComposition({
          registration: runtime.getProviderRegistration(),
          credentialId: pinterestContext.credentialId,
          businessPackageId: pinterestContext.businessPackageId,
          apiBaseUrl: runtime.configuration.apiBaseUrl,
        });
      },
      clearSessionFile: clearPinterestSessionFile,
    });
  }
  return pinterestLifecycle;
}
function getPinterestIpcController() {
  if (!pinterestIpcController) {
    pinterestIpcController = createPinterestIpcController({
      getLifecycle: getPinterestLifecycle,
      getLocalVault: getPinterestLocalVault,
      context: pinterestContext,
    });
  }
  return pinterestIpcController;
}
ipcMain.handle("pinterest:oauth:start", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().startOAuth(request);
  } catch {
    return { ok: false, code: "PINTEREST_RUNTIME_FAILURE", message: "Pinterest authorization could not be started" };
  }
});
ipcMain.handle("pinterest:connection:status", async (_event, credentialId) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().connectionStatus(credentialId);
  } catch {
    return { ok: false, code: "PINTEREST_STATUS_UNAVAILABLE", state: "AuthenticationRequired", message: "Pinterest connection status is unavailable" };
  }
});
ipcMain.handle("pinterest:connection:verify", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().verifyConnection(request);
  } catch {
    return { ok: false, state: "Unavailable", message: "Pinterest connection verification is unavailable" };
  }
});
ipcMain.handle("pinterest:observation:read", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().readObservation(request);
  } catch {
    return { ok: false, state: "Unavailable", message: "Pinterest observation is unavailable" };
  }
});
ipcMain.handle("pinterest:local-config:status", async (_event) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().localConfigStatus();
  } catch {
    return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_UNAVAILABLE" };
  }
});
ipcMain.handle("pinterest:local-config:save", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().saveLocalConfig(request);
  } catch {
    return { ok: false, code: "LOCAL_VAULT_SAVE_FAILED", message: "Pinterest local configuration could not be saved" };
  }
});
ipcMain.handle("pinterest:local-config:clear", async (_event) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return await getPinterestIpcController().clearLocalConfig();
  } catch {
    return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_CLEAR_FAILED" };
  }
});
app.whenReady().then(async () => {
  const initialized = await isInitialized();
  mainWindow = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#9c1c31", webPreferences: { contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: enablePinterestIpcIntegrationTestFrames, sandbox: true, preload: path.join(__dirname, "preload.cjs") } });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!isTrustedUiUrl(url, trustedUiPaths)) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await mainWindow.loadFile(path.join(__dirname, `../ui/${initialized ? "index.html" : "onboarding.html"}`));
  if (initialized) {
    await mainWindow.webContents.insertCSS(`
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
  mainWindow.on("closed", () => { mainWindow = undefined; });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
