import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const runner = path.join(projectRoot, "tests", "integration", "pinterest-electron-windows-runner.cjs");
const { appendCleanupFailure, removeTemporaryUserData } = require(path.join(projectRoot, "tests", "integration", "pinterest-electron-teardown.cjs")) as {
  appendCleanupFailure: (primaryError: unknown, cleanupError: unknown) => Error;
  removeTemporaryUserData: (userDataPath: string) => Promise<void>;
};
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
  const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "alivo-pinterest-electron-"));
  const environment = {
    ...process.env,
    ALIVO_PINTEREST_ELECTRON_INTEGRATION_TEST: "1",
    ALIVO_PINTEREST_ELECTRON_TEST_USER_DATA: temporaryUserData,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const name of restrictedEnvironmentNames) delete environment[name];

  let childResult: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    childError?: Error;
  };
  try {
    childResult = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(electronExecutable, [runner], {
          cwd: projectRoot,
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          childError: error instanceof Error ? error : new Error(String(error)),
        });
        return;
      }
      let stdout = "";
      let stderr = "";
      let childError: Error | undefined;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 60_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => {
        childError = error;
      });
      child.once("close", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut, childError });
      });
    });
  } catch (error) {
    childResult = {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      childError: error instanceof Error ? error : new Error(String(error)),
    };
  }

  let cleanupError: unknown;
  try {
    await removeTemporaryUserData(temporaryUserData);
  } catch (error) {
    cleanupError = error;
  }
  if (childResult.timedOut && !childResult.childError) {
    childResult.childError = new Error("Windows Electron Pinterest IPC integration test timed out");
  }
  return { ...childResult, cleanupError };
}

if (process.platform !== "win32") {
  test("real Windows Electron Pinterest IPC accepts only its own main frame", { skip: "requires Windows Electron" }, () => {});
} else {
  test("real Windows Electron Pinterest IPC accepts only its own main frame", { timeout: 70_000 }, async () => {
    const result = await runWindowsElectronIntegration();
    let primaryError: Error | undefined = result.childError;
    if (!primaryError) {
      try {
        const output = result.stdout.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
        assert.equal(result.exitCode, 0, `Electron runner failed:\n${result.stderr}`);
        assert.ok(output, `Electron runner did not report a result:\n${result.stdout}\n${result.stderr}`);
        assert.deepEqual(JSON.parse(output.slice(resultPrefix.length)), { ok: true });
      } catch (error) {
        primaryError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (result.cleanupError) {
      primaryError = primaryError
        ? appendCleanupFailure(primaryError, result.cleanupError)
        : result.cleanupError instanceof Error ? result.cleanupError : new Error(String(result.cleanupError));
    }
    if (primaryError) throw primaryError;
  });
}