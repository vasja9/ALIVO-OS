import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const runner = path.join(projectRoot, "tests", "integration", "pinterest-electron-windows-runner.cjs");
const resultPrefix = "PINTEREST_ELECTRON_TEST_RESULT=";
const restrictedEnvironmentNames = [
  "ALIVO_PINTEREST_CLIENT_ID",
  "ALIVO_PINTEREST_CLIENT_SECRET",
  "ALIVO_PINTEREST_REDIRECT_URI",
  "ALIVO_PINTEREST_SESSION_SECRET",
  "SESSION_SECRET",
];

async function runWindowsElectronIntegration() {
  const electronExecutable = require("electron") as string;
  const environment = { ...process.env, ALIVO_PINTEREST_ELECTRON_INTEGRATION_TEST: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const name of restrictedEnvironmentNames) delete environment[name];

  return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(electronExecutable, [runner], {
      cwd: projectRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Windows Electron Pinterest IPC integration test timed out"));
    }, 60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

if (process.platform !== "win32") {
  test("real Windows Electron Pinterest IPC accepts only its own main frame", { skip: "requires Windows Electron" }, () => {});
} else {
  test("real Windows Electron Pinterest IPC accepts only its own main frame", { timeout: 70_000 }, async () => {
    const result = await runWindowsElectronIntegration();
    const output = result.stdout.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
    assert.equal(result.exitCode, 0, `Electron runner failed:\n${result.stderr}`);
    assert.ok(output, `Electron runner did not report a result:\n${result.stdout}\n${result.stderr}`);
    assert.deepEqual(JSON.parse(output.slice(resultPrefix.length)), { ok: true });
  });
}