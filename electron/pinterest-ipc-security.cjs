"use strict";

const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

function pathApiFor(platform) {
  return platform === "win32" ? path.win32 : path;
}

function normalizeAllowedPath(value, platform) {
  if (typeof value !== "string" || value.length === 0) return null;
  const resolved = pathApiFor(platform).resolve(value);
  if (platform === "win32" && (!/^[A-Za-z]:\\/.test(resolved) || resolved.startsWith("\\\\"))) return null;
  return resolved;
}

function normalizeTrustedUiUrl(url, platform = process.platform) {
  try {
    if (typeof url !== "string") return null;
    const parsed = new URL(url);
    if (
      url !== parsed.href ||
      parsed.protocol !== "file:" ||
      parsed.hostname ||
      parsed.search ||
      parsed.hash
    ) return null;

    const windows = platform === "win32";
    const decodedPath = fileURLToPath(parsed, { windows });
    if (/%[0-9A-Fa-f]{2}/.test(decodedPath)) return null;
    const normalizedPath = normalizeAllowedPath(decodedPath, platform);
    if (!normalizedPath) return null;
    return pathToFileURL(normalizedPath, { windows }).href === parsed.href ? normalizedPath : null;
  } catch {
    return null;
  }
}

function hasAllowedPath(normalizedPath, allowedPaths, platform) {
  if (!allowedPaths || typeof allowedPaths[Symbol.iterator] !== "function") return false;
  for (const allowedPath of allowedPaths) {
    if (normalizeAllowedPath(allowedPath, platform) === normalizedPath) return true;
  }
  return false;
}

function isTrustedUiUrl(url, allowedPaths, platform = process.platform) {
  const normalizedPath = normalizeTrustedUiUrl(url, platform);
  return Boolean(normalizedPath && hasAllowedPath(normalizedPath, allowedPaths, platform));
}

function isSameMainFrame(frame, mainFrame) {
  if (frame === mainFrame) return true;
  return Number.isInteger(frame?.frameTreeNodeId) &&
    frame.frameTreeNodeId === mainFrame?.frameTreeNodeId;
}

function assertTrustedPinterestSender(event, mainWindow, allowedPaths, platform = process.platform) {
  if (!mainWindow || event?.sender !== mainWindow.webContents) throw new Error("Untrusted Pinterest IPC sender");
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  const framePath = normalizeTrustedUiUrl(frame?.url, platform);
  const mainFramePath = normalizeTrustedUiUrl(mainFrame?.url, platform);
  if (
    !frame ||
    !isSameMainFrame(frame, mainFrame) ||
    !framePath ||
    framePath !== mainFramePath ||
    !hasAllowedPath(framePath, allowedPaths, platform)
  ) throw new Error("Untrusted Pinterest IPC frame");
}

module.exports = { assertTrustedPinterestSender, isTrustedUiUrl };