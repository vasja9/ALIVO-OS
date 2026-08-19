"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

function isTrustedUiUrl(url, allowedPaths) {
  try {
    return new URL(url).protocol === "file:" && allowedPaths.has(path.resolve(fileURLToPath(url)));
  } catch {
    return false;
  }
}

function assertTrustedPinterestSender(event, mainWindow, allowedPaths) {
  if (!mainWindow || event?.sender !== mainWindow.webContents) throw new Error("Untrusted Pinterest IPC sender");
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame || !isTrustedUiUrl(frame.url, allowedPaths)) throw new Error("Untrusted Pinterest IPC frame");
}

module.exports = { assertTrustedPinterestSender, isTrustedUiUrl };