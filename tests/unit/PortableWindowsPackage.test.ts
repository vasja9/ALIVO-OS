import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const builder = readFileSync("electron-builder.yml", "utf8");
const script = readFileSync("scripts/build-portable-windows.mjs", "utf8");

test("portable Windows package is an explicit x64 dir artifact and not an installer", () => {
  assert.match(packageJson.scripts["package:portable:windows"], /scripts\/build-portable-windows\.mjs/);
  assert.match(script, /"run", "build"/);
  assert.match(script, /"--win", "dir", "--x64"/);
  assert.match(script, /ALIVO_PORTABLE_PACKAGE_SUFFIX/);
  assert.match(script, /ALIVO-OS-Pinterest-OAuth-\$\{packageSuffix\}-win-x64/);
  assert.match(script, /packageFileName = `\$\{packageFolderName\}\.zip`/);
  assert.match(script, /README-FIRST\.txt/);
  assert.match(script, /createHash\("sha256"\)/);
  assert.match(script, /keepEnglishLocaleOnly/);
  assert.match(script, /entry !== "en-US\.pak"/);
  assert.match(script, /"-9", "-X", "-r"/);
  assert.match(script, /rm\(unpackedDirectory/);
  assert.doesNotMatch(script, /rm\(releaseDirectory/);
  assert.doesNotMatch(script, /entry !== packageFileName/);
  assert.doesNotMatch(script, /nsis|installer/i);
  assert.match(builder, /!\*\*\/\*\.map/);
  assert.match(builder, /!\*\*\/\*\.env\*/);
  assert.match(builder, /!\*\*\/pinterest-local-config\.enc/);
});

test("portable package verification rejects credentials and development-only content", () => {
  for (const value of ["sentinel-local-app-secret", "sentinel-local-app-id", "README-FIRST.txt", "http://localhost:48123/pinterest/oauth/callback"]) {
    assert.match(script, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(script, /pinterest-local-config\\\.enc/);
  assert.match(script, /tests\?\|coverage\|__tests__\|scripts\|src/);
  assert.match(script, /source maps|\.map\$|forbiddenPath/);
  assert.doesNotMatch(script, /process\.env\.(ALIVO_PINTEREST|REPLIT|SESSION_SECRET)/);
});