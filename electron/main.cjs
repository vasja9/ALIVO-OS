const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { configurePersistentDataPath } = require("./paths.cjs");
const { createPinterestRuntime, PinterestRuntimeError, readConfiguration } = require("./pinterest-runtime.cjs");
const {
  PinterestLocalVaultError,
  createPinterestLocalVault,
  defaultPinterestLocalVaultPath,
} = require("./pinterest-local-vault.cjs");
const { assertTrustedPinterestSender, isTrustedUiUrl } = require("./pinterest-ipc-security.cjs");
const { createPinterestContextResolver } = require("./pinterest-context.cjs");

configurePersistentDataPath(app);
const onboardingFile = () => path.join(app.getPath("userData"), "state", "onboarding.json");
async function isInitialized() { try { const state = JSON.parse(await fs.readFile(onboardingFile(), "utf8")); return state.schemaVersion === 1 && state.completed === true; } catch { return false; } }
ipcMain.handle("onboarding:complete", async () => { const target = onboardingFile(), temporary = `${target}.tmp`; await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, completed: true, completedAt: new Date().toISOString() }), { mode: 0o600 }); await fs.rename(temporary, target); return true; });
let pinterestRuntime;
let pinterestComposition;
let pinterestLocalVault;
let mainWindow;
const trustedUiPaths = new Set([path.resolve(__dirname, "../ui/index.html"), path.resolve(__dirname, "../ui/onboarding.html")]);
const pinterestContext = createPinterestContextResolver();
function getPinterestLocalVault() {
  if (!pinterestLocalVault) {
    pinterestLocalVault = createPinterestLocalVault({
      filePath: defaultPinterestLocalVaultPath(app.getPath("userData")),
      safeStorage,
    });
  }
  return pinterestLocalVault;
}
async function getPinterestRuntime() {
  if (!pinterestRuntime) {
    const localConfiguration = await getPinterestLocalVault().resolveConfiguration(process.env, !app.isPackaged);
    pinterestRuntime = createPinterestRuntime({
      configuration: localConfiguration || readConfiguration({}),
      userDataPath: () => app.getPath("userData"),
      openExternal: (url) => shell.openExternal(url),
    });
  }
  return pinterestRuntime;
}
async function getPinterestComposition() {
  if (!pinterestComposition) {
    const { createPinterestElectronComposition } = require("./generated/integrations/pinterest/PinterestElectronComposition.cjs");
    const runtime = await getPinterestRuntime();
    pinterestComposition = createPinterestElectronComposition({
      registration: runtime.getProviderRegistration(),
      credentialId: pinterestContext.credentialId,
      businessPackageId: pinterestContext.businessPackageId,
      apiBaseUrl: runtime.configuration.apiBaseUrl,
    });
  }
  return pinterestComposition;
}
async function resetPinterestRuntime() {
  if (pinterestRuntime) await pinterestRuntime.close();
  pinterestRuntime = undefined;
  pinterestComposition = undefined;
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
ipcMain.handle("pinterest:oauth:start", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    const result = await (await getPinterestRuntime()).startAuthorization(pinterestContext.resolve(request));
    return { ok: true, authorizationUrl: result.authorizationUrl, redirectUri: result.redirectUri, expiresAt: result.expiresAt };
  } catch (error) {
    const safe = error instanceof PinterestRuntimeError ? error.message : "Pinterest authorization could not be started";
    return { ok: false, code: error?.code || "PINTEREST_RUNTIME_FAILURE", message: safe };
  }
});
ipcMain.handle("pinterest:connection:status", async (_event, credentialId) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    if (credentialId !== undefined && credentialId !== pinterestContext.credentialId) throw new Error("Pinterest credential is not authorized");
    return { ok: true, ...(await (await getPinterestRuntime()).status(pinterestContext.credentialId)) };
  } catch {
    return { ok: false, state: "AuthenticationRequired", message: "Pinterest connection status is unavailable" };
  }
});
ipcMain.handle("pinterest:connection:verify", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return { ok: true, ...(await (await getPinterestComposition()).verifyConnection(pinterestContext.resolve(request))) };
  } catch {
    return { ok: false, state: "Unavailable", message: "Pinterest connection verification is unavailable" };
  }
});
ipcMain.handle("pinterest:observation:read", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return { ok: true, ...(await (await getPinterestComposition()).readObservation(pinterestContext.resolve(request))) };
  } catch {
    return { ok: false, state: "Unavailable", message: "Pinterest observation is unavailable" };
  }
});
ipcMain.handle("pinterest:local-config:status", async (_event) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    return { ok: true, ...(await getPinterestLocalVault().status()) };
  } catch {
    return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_UNAVAILABLE" };
  }
});
ipcMain.handle("pinterest:local-config:save", async (_event, request) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    const result = await getPinterestLocalVault().save({
      clientId: request?.clientId,
      clientSecret: request?.clientSecret,
      redirectUri: request?.redirectUri,
    });
    await clearPinterestSessionFile();
    await resetPinterestRuntime();
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof PinterestLocalVaultError ? error.code : "LOCAL_VAULT_SAVE_FAILED",
      message: error instanceof PinterestLocalVaultError && error.code === "LOCAL_CONFIG_INVALID"
        ? error.message
        : "Pinterest local configuration could not be saved",
    };
  }
});
ipcMain.handle("pinterest:local-config:clear", async (_event) => {
  try {
    assertTrustedPinterestSender(_event, mainWindow, trustedUiPaths);
    const result = await getPinterestLocalVault().clear();
    await clearPinterestSessionFile();
    await resetPinterestRuntime();
    return { ok: true, ...result };
  } catch {
    return { ok: false, configured: false, encryptionAvailable: false, code: "LOCAL_VAULT_CLEAR_FAILED" };
  }
});
app.whenReady().then(async () => {
  const initialized = await isInitialized();
  mainWindow = new BrowserWindow({ title: "ALIVO OS", width: 1280, height: 800, minWidth: 760, minHeight: 600, backgroundColor: "#9c1c31", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") } });
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
