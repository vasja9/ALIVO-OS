import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolvePersistentDataPath } = require("../../electron/paths.cjs");

test("installer preserves application data and uses an x64 NSIS target", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(manifest.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.equal(manifest.build.asar, true);
});

test("persistent state is separate from the replaceable installation directory", () => {
  const dataPath = resolvePersistentDataPath("C:\\Users\\CEO\\AppData\\Roaming");
  assert.equal(dataPath, "C:\\Users\\CEO\\AppData\\Roaming\\ALIVO OS");
  assert.doesNotMatch(dataPath, /Program Files/);
  assert.throws(() => resolvePersistentDataPath("relative/path"), /absolute/);
});
