const path = require("node:path");
const fs = require("node:fs/promises");

function createCredentialStore(app, safeStorage) {
  const file = path.join(app.getPath("userData"), "credentials", "desktop-credentials.json");

  async function readAll() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  async function saveAll(value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async function put(id, secret) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure credential encryption is unavailable.");
    const all = await readAll();
    all[id] = safeStorage.encryptString(JSON.stringify(secret)).toString("base64");
    await saveAll(all);
  }

  async function get(id) {
    const all = await readAll();
    if (!all[id]) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure credential encryption is unavailable.");
    return JSON.parse(safeStorage.decryptString(Buffer.from(all[id], "base64")));
  }

  async function remove(id) {
    const all = await readAll();
    if (!(id in all)) return false;
    delete all[id];
    await saveAll(all);
    return true;
  }

  return Object.freeze({ put, get, remove });
}

module.exports = { createCredentialStore };
