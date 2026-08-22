import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const builder = readFileSync("electron-builder.yml", "utf8");
const script = readFileSync("scripts/build-portable-windows.mjs", "utf8");

test("portable Windows package is an explicit x64 dir artifact and not an installer", () => {
  assert.equal(packageJson.devDependencies.yazl, "3.3.1");
  assert.match(packageJson.scripts["package:portable:windows"], /scripts\/build-portable-windows\.mjs/);
  assert.match(script, /"run", "build"/);
  assert.match(script, /"--win", "dir", "--x64"/);
  assert.match(script, /process\.execPath/);
  assert.match(script, /process\.env\.npm_execpath/);
  assert.match(script, /node_modules", "electron-builder", "cli\.js/);
  assert.doesNotMatch(script, /npm\.cmd/);
  assert.doesNotMatch(script, /electron-builder\.cmd/);
  assert.doesNotMatch(script, /shell:\s*true/);
  assert.doesNotMatch(script, /cmd\.exe/i);
  assert.match(script, /\["PATH", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "ELECTRON_CACHE", "XDG_CACHE_HOME", "npm_config_cache"\]/);
  assert.doesNotMatch(script, /\.\.\.process\.env/);
  assert.doesNotMatch(script, /process\.env\.(?:ALIVO_PINTEREST\w*|SESSION_SECRET|REPLIT\w*)/);
  assert.match(script, /entry\.replace\(\/\^\[\/\\\\\]\+\//);
  assert.equal("/electron/generated/core/platform/AuditEvent.cjs".replace(/^[/\\]+/, ""), "electron/generated/core/platform/AuditEvent.cjs");
  assert.equal("\\electron\\generated\\core\\platform\\AuditEvent.cjs".replace(/^[/\\]+/, ""), "electron\\generated\\core\\platform\\AuditEvent.cjs");
  assert.match(script, /files\.sort\(\(left, right\) => left\.relativePath < right\.relativePath \? -1 : left\.relativePath > right\.relativePath \? 1 : 0\)/);
  assert.match(script, /relativePath = path\.join\([\s\S]*?\.replaceAll\("\\\\", "\/"\)/);
  assert.match(script, /mtime: fixedZipTimestamp/);
  assert.match(script, /mode: fixedZipMode/);
  assert.match(script, /compressionLevel: 9/);
  assert.match(script, /forceDosTimestamp: true/);
  assert.match(script, /info\.isSymbolicLink\(\).*Portable ZIP source contains a symbolic link/);
  assert.doesNotMatch(script, /runStreaming\("(?:zip|tar(?:\.exe)?)"/);
  assert.match(script, /process\.env\.SystemRoot \?\? process\.env\.WINDIR/);
  assert.match(script, /path\.isAbsolute\(systemRoot\)/);
  assert.match(script, /path\.join\(systemRoot, "System32", "tar\.exe"\)/);
  assert.match(script, /tarStat\.isFile\(\)/);
  assert.match(script, /run\(await resolveWindowsTarPath\(\), \["-tf", packagePath\]\)/);
  assert.doesNotMatch(script, /run\("tar\.exe"/);
  assert.doesNotMatch(script, /\["-a", "-c"|\["-9", "-X", "-r"/);
  assert.doesNotMatch(script, /Compress-Archive|shell:\s*true|cmd\.exe/i);
  assert.match(script, /ALIVO_PORTABLE_PACKAGE_SUFFIX/);
  assert.match(script, /ALIVO-OS-Pinterest-OAuth-\$\{packageSuffix\}-win-x64/);
  assert.match(script, /packageFileName = `\$\{packageFolderName\}\.zip`/);
  assert.match(script, /README-FIRST\.txt/);
  assert.match(script, /createHash\("sha256"\)/);
  assert.match(script, /keepEnglishLocaleOnly/);
  assert.match(script, /entry !== "en-US\.pak"/);
  assert.match(script, /createDeterministicZip\(stagingDirectory, packagePath, packageFolderName\)/);
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
