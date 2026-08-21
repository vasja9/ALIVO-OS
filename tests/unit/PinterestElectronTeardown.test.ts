import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  appendCleanupFailure,
  removeTemporaryUserData,
} = require("../integration/pinterest-electron-teardown.cjs") as {
  appendCleanupFailure: (primaryError: unknown, cleanupError: unknown) => Error;
  removeTemporaryUserData: (
    userDataPath: string,
    options: {
      platform: string;
      rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
      sleepFn: (milliseconds: number) => Promise<void>;
      maxAttempts: number;
      initialDelayMilliseconds: number;
      maxDelayMilliseconds: number;
    },
  ) => Promise<void>;
};

const cleanupError = (code: string) => Object.assign(new Error(`simulated ${code}`), { code });

test("Windows temporary userData cleanup retries only transient directory-lock errors", async () => {
  let attempts = 0;
  const delays: number[] = [];
  await removeTemporaryUserData("C:\\temp\\alivo-profile", {
    platform: "win32",
    rmSync: () => {
      attempts += 1;
      if (attempts < 3) throw cleanupError("EBUSY");
    },
    sleepFn: async (milliseconds) => { delays.push(milliseconds); },
    maxAttempts: 8,
    initialDelayMilliseconds: 10,
    maxDelayMilliseconds: 100,
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("Windows temporary userData cleanup fails clearly for non-transient errors", async () => {
  let attempts = 0;
  await assert.rejects(
    removeTemporaryUserData("C:\\temp\\alivo-profile", {
      platform: "win32",
      rmSync: () => {
        attempts += 1;
        throw cleanupError("EACCES");
      },
      sleepFn: async () => {},
      maxAttempts: 8,
      initialDelayMilliseconds: 10,
      maxDelayMilliseconds: 100,
    }),
    /Failed to remove temporary Electron userData after 1 attempt/,
  );
  assert.equal(attempts, 1);
});

test("teardown cleanup details do not replace the primary scenario failure", () => {
  const primary = new Error("security assertion failed");
  const combined = appendCleanupFailure(primary, cleanupError("EPERM"));
  assert.strictEqual(combined, primary);
  assert.match(combined.message, /^security assertion failed/);
  assert.match(combined.message, /Teardown cleanup failed: .*EPERM/);
});