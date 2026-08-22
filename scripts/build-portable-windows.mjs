import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { promisify } from "node:util";
import { cp, lstat, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import yazl from "yazl";

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
const fixedZipTimestamp = new Date(2020, 0, 1, 0, 0, 0, 0);
const fixedZipMode = 0o100644;
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
  for (const key of ["PATH", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "ELECTRON_CACHE", "XDG_CACHE_HOME", "npm_config_cache"]) {
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

async function requireJavaScriptCli(cliPath, description) {
  let cliStat;
  try {
    cliStat = await stat(cliPath);
  } catch {
    throw new Error(`${description} JavaScript CLI does not exist: ${cliPath}`);
  }
  if (!cliStat.isFile()) throw new Error(`${description} JavaScript CLI is not a file: ${cliPath}`);
}

async function resolveNpmCliPath() {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) throw new Error("npm_execpath is required to run the portable package build");
  if (!path.isAbsolute(npmCliPath)) throw new Error(`npm_execpath must be an absolute path: ${npmCliPath}`);
  if (path.basename(npmCliPath).toLowerCase() !== "npm-cli.js") {
    throw new Error(`npm_execpath must point to npm-cli.js: ${npmCliPath}`);
  }
  await requireJavaScriptCli(npmCliPath, "npm");
  return npmCliPath;
}

async function resolveWindowsTarPath() {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) throw new Error("SystemRoot or WINDIR is required to verify the portable Windows ZIP");
  if (!path.isAbsolute(systemRoot)) throw new Error(`SystemRoot or WINDIR must be an absolute path: ${systemRoot}`);
  const tarPath = path.join(systemRoot, "System32", "tar.exe");
  let tarStat;
  try {
    tarStat = await stat(tarPath);
  } catch {
    throw new Error(`Windows system tar executable does not exist: ${tarPath}`);
  }
  if (!tarStat.isFile()) throw new Error(`Windows system tar executable is not a file: ${tarPath}`);
  return tarPath;
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

async function collectZipFiles(directory, relativeDirectory = "") {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const diskPath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name).replaceAll("\\", "/");
    const info = await lstat(diskPath);
    if (info.isSymbolicLink()) throw new Error(`Portable ZIP source contains a symbolic link: ${relativePath}`);
    if (info.isDirectory()) files.push(...await collectZipFiles(diskPath, relativePath));
    else if (info.isFile()) files.push({ diskPath, relativePath });
    else throw new Error(`Portable ZIP source contains an unsupported filesystem entry: ${relativePath}`);
  }
  return files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
}

export async function createDeterministicZip(sourceDirectory, archivePath, archiveRoot) {
  const files = await collectZipFiles(sourceDirectory);
  const zipFile = new yazl.ZipFile();
  const output = createWriteStream(archivePath, { flags: "w" });
  const completed = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };
    zipFile.outputStream.once("error", fail);
    output.once("error", fail);
    output.once("finish", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
  zipFile.outputStream.pipe(output);
  for (const file of files) {
    zipFile.addFile(file.diskPath, `${archiveRoot}/${file.relativePath}`, {
      mtime: fixedZipTimestamp,
      mode: fixedZipMode,
      compressionLevel: 9,
      forceDosTimestamp: true,
    });
  }
  zipFile.end();
  await completed;
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
  const entries = listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, ""));
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
  const { stdout } = process.platform === "win32"
    ? await run(await resolveWindowsTarPath(), ["-tf", packagePath])
    : await run("unzip", ["-Z1", packagePath]);
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
  const npmCliPath = await resolveNpmCliPath();
  const builderCliPath = path.join(root, "node_modules", "electron-builder", "cli.js");
  await requireJavaScriptCli(builderCliPath, "Electron Builder");
  await run(process.execPath, [npmCliPath, "run", "build"]);
  await run(process.execPath, [builderCliPath, "--win", "dir", "--x64", "--config", "electron-builder.yml", "--publish", "never"]);
  await keepEnglishLocaleOnly(unpackedDirectory);
  await verifyUnpackedPackage(unpackedDirectory);

  await cp(unpackedDirectory, stagingDirectory, { recursive: true });
  await writeFile(path.join(stagingDirectory, "README-FIRST.txt"), readme, { encoding: "utf8", mode: 0o600 });
  await normalizeMtimes(stagingDirectory);
  await createDeterministicZip(stagingDirectory, packagePath, packageFolderName);
  const checksum = createHash("sha256").update(await readFile(packagePath)).digest("hex");
  await writeFile(checksumPath, `${checksum}  ${packageFileName}\n`, { encoding: "utf8", mode: 0o600 });
  await verifyZipContents();
  const packageSize = (await stat(packagePath)).size;

  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(unpackedDirectory, { recursive: true, force: true });
  console.log(JSON.stringify({ packagePath: path.relative(root, packagePath), checksumPath: path.relative(root, checksumPath), bytes: packageSize, sha256: checksum }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
