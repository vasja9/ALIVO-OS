"use strict";

const fs = require("node:fs");

const TRANSIENT_WINDOWS_CLEANUP_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error) {
  return error?.stack || error?.message || String(error);
}

function appendCleanupFailure(primaryError, cleanupError) {
  const error = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
  const cleanupMessage = `Teardown cleanup failed: ${formatError(cleanupError)}`;
  error.message = `${error.message}\n${cleanupMessage}`;
  error.stack = `${formatError(error)}\n${cleanupMessage}`;
  return error;
}

async function removeTemporaryUserData(userDataPath, {
  platform = process.platform,
  rmSync = fs.rmSync,
  sleepFn = sleep,
  maxAttempts = 8,
  initialDelayMilliseconds = 50,
  maxDelayMilliseconds = 1_000,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(userDataPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const retryable = platform === "win32"
        && TRANSIENT_WINDOWS_CLEANUP_CODES.has(error?.code)
        && attempt < maxAttempts;
      if (!retryable) {
        const failure = new Error(
          `Failed to remove temporary Electron userData after ${attempt} attempt(s): ${formatError(error)}`,
          { cause: error },
        );
        failure.code = error?.code;
        throw failure;
      }
      const delay = Math.min(
        initialDelayMilliseconds * (2 ** (attempt - 1)),
        maxDelayMilliseconds,
      );
      await sleepFn(delay);
    }
  }

  throw new Error(
    `Failed to remove temporary Electron userData after ${maxAttempts} attempts: ${formatError(lastError)}`,
    { cause: lastError },
  );
}

module.exports = {
  TRANSIENT_WINDOWS_CLEANUP_CODES,
  appendCleanupFailure,
  removeTemporaryUserData,
};