import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
const builderConfiguration = await readFile("electron-builder.yml", "utf8");
const installerConfiguration = await readFile("installer/windows-installer.nsh", "utf8");

assert.equal(packageMetadata.main, "electron/main.cjs");
assert.match(packageMetadata.scripts["package:win"], /electron-builder --win nsis --x64/);
assert.match(builderConfiguration, /target: nsis/);
assert.match(builderConfiguration, /output: release/);
assert.match(builderConfiguration, /include: installer\/windows-installer\.nsh/);
assert.match(builderConfiguration, /artifactName:.*Setup\.\$\{ext\}/);
assert.match(builderConfiguration, /!\*\*\/\*\.map/);
assert.match(builderConfiguration, /!\*\*\/\*\.env\*/);
assert.match(builderConfiguration, /!\*\*\/pinterest-local-config\.enc/);
assert.match(installerConfiguration, /\$\{AtLeastWin10\}/);

console.log("Windows packaging configuration is valid.");
