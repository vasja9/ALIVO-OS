const path = require("node:path");

const WINDOWS_DATA_DIRECTORY = "ALIVO OS";

function resolvePersistentDataPath(appDataPath) {
  const pathApi = path.win32.isAbsolute(appDataPath) ? path.win32 : path;
  if (!pathApi.isAbsolute(appDataPath)) {
    throw new TypeError("The application data path must be absolute");
  }
  return pathApi.join(appDataPath, WINDOWS_DATA_DIRECTORY);
}

function configurePersistentDataPath(app) {
  if (process.platform === "win32") {
    app.setPath("userData", resolvePersistentDataPath(app.getPath("appData")));
  }
}

module.exports = {
  WINDOWS_DATA_DIRECTORY,
  configurePersistentDataPath,
  resolvePersistentDataPath,
};
