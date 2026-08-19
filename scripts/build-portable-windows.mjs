import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const releaseDirectory = path.join(root, "release");
const unpackedDirectory = path.join(releaseDirectory, "win-unpacked");
const packageSuffix = process.env.ALIVO_PORTABLE_PACKAGE_SUFFIX?.trim() || "Test";
if (!/^[A-Za-z0-9.-]+$/.test(packageSuffix)) throw new Error("Portable package suffix contains unsafe filename characters");
const packageFolderName = `ALIVO-OS-Pinterest-OAuth-${packageSuffix}-win-x64`;
const packageFileName = `${packageFolderName}.zip`;
const packagePath = path.join(releaseDirectory, packageFileName);
const checksumPath = `${packagePath}.sha256`;
const stagingDirectory = path.join(releaseDirectory, packageFolderName);
const fixedTimestamp = new Date("2020-01-01T00:00:00.000Z");
const sentinelValues = ["sentinel-local-app-id", "sentinel-local-app-secret"];
const forbiddenPath = /(?:^|\/)(?:tests?|coverage|__tests__|scripts|src|\.local|\.git|node_modules|package-lock\.json)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.map$|pinterest-local-config\.enc/i;
const forbiddenText = /sentinel-local-app-id|sentinel-local-app-secret|replit|BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY/i;
const readme = `ALIVO OS Pinterest OAuth portable test package

TEST ARTIFACT ONLY — NOT A FINAL DISTRIBUTION

1. Extract this ZIP to an ordinary user-writable folder.
2. Start ALIVO OS.exe.
3. Open Settings, then Pinterest.
4. Enter your Pinterest App ID and App Secret.
5. Confirm the Redirect URI is exactly:
   http://localhost:48123/pinterest/oauth/callback
6. Click Connect.

This package contains no Pinterest credentials. Do not share credentials or tokens.
Clear the local Pinterest configuration after testing.
`;

function safeBuildEnvironment() {
  const environment = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "ELECTRON_CACHE", "XDG_CACHE_HOME", "npm_config_cache"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  environment.FORCE_COLOR = "0";
  return environment;
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: root,
    env: safeBuildEnvironment(),
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function runStreaming(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: safeBuildEnvironment(),
      windowsHide: true,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function removeGeneratedOutput() {
  await rm(unpackedDirectory, { recursive: true, force: true });
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(releaseDirectory, { recursive: true });
}

async function normalizeMtimes(target) {
  const info = await stat(target);
  if (info.isDirectory()) {
    for (const entry of await readdir(target)) await normalizeMtimes(path.join(target, entry));
  }
  await utimes(target, fixedTimestamp, fixedTimestamp);
}

function assertSafeEntry(entry) {
  const normalized = entry.replaceAll("\\", "/").replace(/^\/+/, "");
  if (forbiddenPath.test(normalized)) throw new Error(`Portable package contains forbidden path: ${normalized}`);
}

function assertSafeText(location, text) {
  if (forbiddenText.test(text)) throw new Error(`Portable package contains forbidden text in ${location}`);
}

async function verifyUnpackedPackage(directory) {
  const executable = path.join(directory, "ALIVO OS.exe");
  await stat(executable);
  const asarPath = path.join(directory, "resources", "app.asar");
  await stat(asarPath);
  const entries = listPackage(asarPath).map((entry) => entry.replace(/^\/+/, ""));
  for (const entry of entries) {
    assertSafeEntry(`resources/app.asar/${entry}`);
    if (/\.(?:c?js|json|html|css|txt)$/i.test(entry)) {
      assertSafeText(`resources/app.asar/${entry}`, extractFile(asarPath, entry).toString("utf8"));
    }
  }
  const topLevel = await readdir(directory, { withFileTypes: true });
  for (const entry of topLevel) assertSafeEntry(entry.name);
}

async function keepEnglishLocaleOnly(directory) {
  const localesDirectory = path.join(directory, "locales");
  for (const entry of await readdir(localesDirectory)) {
    if (entry !== "en-US.pak") await rm(path.join(localesDirectory, entry), { force: true });
  }
}

async function verifyZipContents() {
  const { stdout } = await run(process.platform === "win32" ? "tar.exe" : "unzip", process.platform === "win32"
    ? ["-tf", packagePath]
    : ["-Z1", packagePath]);
  const entries = stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.includes(`${packageFolderName}/README-FIRST.txt`)) throw new Error("Portable ZIP is missing README-FIRST.txt");
  if (!entries.includes(`${packageFolderName}/ALIVO OS.exe`)) throw new Error("Portable ZIP is missing ALIVO OS.exe");
  for (const entry of entries) assertSafeEntry(entry);
  const readmeText = await readFile(path.join(stagingDirectory, "README-FIRST.txt"), "utf8");
  assertSafeText("README-FIRST.txt", readmeText);
  if (/npm|node_modules|electron-builder|\/home\/|\\Users\\|Replit|ALIVO_PINTEREST_|SESSION_SECRET/i.test(readmeText)) {
    throw new Error("README-FIRST.txt contains a forbidden internal path, command, or secret reference");
  }
}

async function main() {
  await removeGeneratedOutput();
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const builderCommand = process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "electron-builder.cmd")
    : path.join(root, "node_modules", ".bin", "electron-builder");
  await run(npmCommand, ["run", "build"]);
  await run(builderCommand, ["--win", "dir", "--x64", "--config", "electron-builder.yml", "--publish", "never"]);
  await keepEnglishLocaleOnly(unpackedDirectory);
  await verifyUnpackedPackage(unpackedDirectory);

  await cp(unpackedDirectory, stagingDirectory, { recursive: true });
  await writeFile(path.join(stagingDirectory, "README-FIRST.txt"), readme, { encoding: "utf8", mode: 0o600 });
  await normalizeMtimes(stagingDirectory);
  await runStreaming("zip", ["-9", "-X", "-r", packagePath, packageFolderName], { cwd: releaseDirectory });
  const checksum = createHash("sha256").update(await readFile(packagePath)).digest("hex");
  await writeFile(checksumPath, `${checksum}  ${packageFileName}\n`, { encoding: "utf8", mode: 0o600 });
  await verifyZipContents();
  const packageSize = (await stat(packagePath)).size;

  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(unpackedDirectory, { recursive: true, force: true });
  console.log(JSON.stringify({ packagePath: path.relative(root, packagePath), checksumPath: path.relative(root, checksumPath), bytes: packageSize, sha256: checksum }));
}

await main();