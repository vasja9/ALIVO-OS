import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertTrustedPinterestSender } = require("../../electron/pinterest-ipc-security.cjs");

const main = readFileSync("electron/main.cjs", "utf8");
const preload = readFileSync("electron/preload.cjs", "utf8");
const vault = readFileSync("electron/pinterest-local-vault.cjs", "utf8");
const runtime = readFileSync("electron/pinterest-runtime.cjs", "utf8");
const builder = readFileSync("electron-builder.yml", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const settings = readFileSync("ui/settings.js", "utf8");

test("local Pinterest configuration stays behind trusted main-process IPC", () => {
  assert.match(preload, /alivoPinterestLocalConfig/);
  for (const method of ["status", "save", "clear"]) assert.match(preload, new RegExp(`${method}: \\(`));
  assert.doesNotMatch(preload, /clientSecret|sessionSecret|process\.env|safeStorage/);
  for (const channel of ["pinterest:local-config:status", "pinterest:local-config:save", "pinterest:local-config:clear"]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel}"`));
  }
  assert.match(main, /createPinterestLocalVault/);
  assert.match(main, /assertTrustedPinterestSender\(_event, mainWindow, trustedUiPaths\)/);
  assert.match(main, /app\.isPackaged/);
  assert.match(main, /resolveConfiguration\(process\.env, !app\.isPackaged\)/);
  assert.match(main, /await clearPinterestSessionFile\(\);[\s\S]*?await resetPinterestRuntime\(\);/);
});

test("local configuration IPC inherits trusted sender and frame rejection", () => {
  const allowedPaths = new Set([path.resolve("ui/index.html")]);
  const mainWindow = { webContents: {} };
  assert.throws(
    () => assertTrustedPinterestSender({ sender: {}, senderFrame: undefined }, mainWindow, allowedPaths),
    /Untrusted Pinterest IPC sender/,
  );
  assert.throws(
    () => assertTrustedPinterestSender({
      sender: mainWindow.webContents,
      senderFrame: { url: "file:///tmp/untrusted.html", mainFrame: {} },
    }, mainWindow, allowedPaths),
    /Untrusted Pinterest IPC frame/,
  );
  for (const channel of ["pinterest:local-config:status", "pinterest:local-config:save", "pinterest:local-config:clear"]) {
    const start = main.indexOf(`ipcMain.handle("${channel}"`);
    const end = main.indexOf("});", start);
    assert.ok(start >= 0 && end > start);
    assert.match(main.slice(start, end), /assertTrustedPinterestSender/);
  }
});

test("local vault is DPAPI-backed through safeStorage, status-only, atomic, and strict", () => {
  for (const source of [
    /safeStorage/,
    /electron-safeStorage/,
    /LOCAL_VAULT_CORRUPT/,
    /ENCRYPTION_UNAVAILABLE/,
    /DEFAULT_LOCAL_REDIRECT_URI/,
    /await fileSystem\.rename\(temporary, filePath\)/,
    /sessionSecret: randomBytes\(32\)/,
  ]) assert.match(vault, source);
  assert.match(vault, /redirectUri !== DEFAULT_LOCAL_REDIRECT_URI/);
  assert.match(vault, /query strings|query or hash|approved localhost callback/i);
});

test("secret-bearing runtime paths do not log and package/source maps do not embed credentials", () => {
  assert.match(runtime, /method: "POST"/);
  assert.match(runtime, /PINTEREST_TOKEN_PATH/);
  assert.doesNotMatch(runtime, /console\.(log|error|warn|info)\([^)]*clientSecret/i);
  assert.match(runtime, /redactSensitive/);
  assert.match(builder, /asar: true/);
  assert.match(builder, /!\*\*\/\*\.map/);
  assert.match(builder, /!\*\*\/\*\.env\*/);
  assert.match(builder, /!\*\*\/pinterest-local-config\.enc/);
  assert.match(packageJson, /!\*\*\/\*\.map/);
  assert.match(packageJson, /!\*\*\/\*\.env\*/);
  assert.match(packageJson, /!\*\*\/pinterest-local-config\.enc/);
  assert.doesNotMatch(builder, /client-secret|sentinel-local-app-secret/);
  assert.match(packageJson, /"files": \[/);
  assert.doesNotMatch(packageJson, /client-secret|sentinel-local-app-secret/);
});

test("Settings UI sends write-only credential input and exposes boolean state plus clear/reconfigure", () => {
  for (const value of [
    "alivoPinterestLocalConfig",
    "pinterest-local-client-id",
    "pinterest-local-client-secret",
    "Save local credentials",
    "Clear local credentials",
    "Reconfigure",
    "Local vault configured",
    "Session material present",
    "The secret will not be shown",
    "clientSecret.value=''",
  ]) assert.match(settings, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(settings, /localStorage|indexedDB|fetch\(|XMLHttpRequest|process\.env/);
});
