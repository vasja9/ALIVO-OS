const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const serialized = JSON.stringify(manifest);

assert.equal(manifest.version, "1.0.0");
assert.equal(manifest.build.artifactName, "ALIVO-OS-v${version}-Setup.${ext}");
assert.deepEqual(manifest.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false);
assert.equal(manifest.scripts["package:windows"], "electron-builder --win nsis --x64");
assert.doesNotMatch(serialized, /(?:[A-Za-z]:\\\\|\/Users\/|\/home\/|\/workspace\/)/);
for (const dependency of Object.values({
  ...manifest.dependencies,
  ...manifest.devDependencies,
})) {
  assert.doesNotMatch(dependency, /^(?:file:|link:)|node_modules[\\/]/);
}

console.log("Windows packaging manifest is portable and release-ready.");
