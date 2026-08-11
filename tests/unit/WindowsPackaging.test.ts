import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageMetadata = JSON.parse(readFileSync("package.json", "utf8"));
const builderConfiguration = readFileSync("electron-builder.yml", "utf8");
const installerConfiguration = readFileSync("installer/windows-installer.nsh", "utf8");
const ignoreRules = readFileSync(".gitignore", "utf8");

test("production Windows packaging is source-controlled and targets x64 NSIS", () => {
  assert.match(packageMetadata.scripts["package:win"], /electron-builder --win nsis --x64/);
  assert.match(builderConfiguration, /target: nsis/);
  assert.match(builderConfiguration, /arch:\s*\n\s*- x64/);
  assert.match(builderConfiguration, /artifactName:.*Setup\.\$\{ext\}/);
  assert.match(builderConfiguration, /oneClick: false/);
  assert.match(builderConfiguration, /perMachine: true/);
  assert.match(builderConfiguration, /executableName: ALIVO OS/);
  assert.match(builderConfiguration, /createDesktopShortcut: always/);
  assert.match(builderConfiguration, /createStartMenuShortcut: true/);
  assert.match(builderConfiguration, /runAfterFinish: false/);
});

test("installer enforces supported Windows versions", () => {
  assert.match(builderConfiguration, /include: installer\/windows-installer\.nsh/);
  assert.match(installerConfiguration, /\$\{AtLeastWin10\}/);
  assert.match(installerConfiguration, /requires Windows 10 or Windows 11/);
});

test("generated Windows packaging artifacts are ignored", () => {
  for (const rule of ["dist/", "release/", "out/", "*.exe", "*.dll", "*.msi", "*.blockmap", "packaged/"]) {
    assert.match(ignoreRules, new RegExp(`^${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});
