import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const normalizeLineEndings = (source: string) => source.replace(/\r\n?/g, "\n");
const makefile = normalizeLineEndings(readFileSync(new URL("../../Makefile", import.meta.url), "utf8"));
const replit = normalizeLineEndings(readFileSync(new URL("../../.replit", import.meta.url), "utf8"));
const attributes = normalizeLineEndings(readFileSync(new URL("../../.gitattributes", import.meta.url), "utf8"));
const workflowTemplate = normalizeLineEndings(readFileSync(new URL("../../ci/templates/pinterest-oauth-test3-windows.yml", import.meta.url), "utf8"));
const test34WorkflowTemplate = normalizeLineEndings(readFileSync(new URL("../../ci/templates/pinterest-oauth-test3.4-windows.yml", import.meta.url), "utf8"));
const test35WorkflowTemplate = normalizeLineEndings(readFileSync(new URL("../../ci/templates/pinterest-oauth-test3.5-windows.yml", import.meta.url), "utf8"));
const test36WorkflowTemplate = normalizeLineEndings(readFileSync(new URL("../../ci/templates/pinterest-oauth-test3.6-windows.yml", import.meta.url), "utf8"));
const test37WorkflowTemplate = normalizeLineEndings(readFileSync(new URL("../../ci/templates/pinterest-oauth-test3.7-windows.yml", import.meta.url), "utf8"));
const auditSource = normalizeLineEndings(readFileSync(new URL("../../scripts/audit_build0.py", import.meta.url), "utf8"));
const harnessSource = normalizeLineEndings(readFileSync(new URL("../harness/PinterestDomHarness.js", import.meta.url), "utf8"));
const electronMainSource = normalizeLineEndings(readFileSync(new URL("../../electron/main.cjs", import.meta.url), "utf8"));
const electronRunnerSource = normalizeLineEndings(readFileSync(new URL("../integration/pinterest-electron-windows-runner.cjs", import.meta.url), "utf8"));
const electronWindowsTestSource = normalizeLineEndings(readFileSync(new URL("../integration/PinterestElectronWindows.test.ts", import.meta.url), "utf8"));

test("Pinterest DOM integration has a direct Node transform gate", () => {
  assert.equal(
    packageJson.scripts["test:pinterest:dom"],
    "node --experimental-transform-types --test tests/unit/PinterestDomIntegration.test.ts",
  );
  assert.match(makefile, /^pinterest-dom:\n\tnpm run test:pinterest:dom$/m);
  assert.match(replit, /name = "pinterest-dom"[\s\S]*?args = "npm run test:pinterest:dom"[\s\S]*?isValidation = true/);
});

test("Pinterest DOM validation contracts are independent of Windows checkout line endings", () => {
  const crlfSource = "pinterest-dom:\r\n\tnpm run test:pinterest:dom\r\n";
  assert.equal(normalizeLineEndings(crlfSource), "pinterest-dom:\n\tnpm run test:pinterest:dom\n");
  assert.match(normalizeLineEndings("before\r\nmiddle\rafter\n"), /^before\nmiddle\nafter\n$/);
});

test("Pinterest DOM gate fails closed before Windows package verification", () => {
  assert.match(
    packageJson.scripts["package:verify"],
    /^npm run verify:package-sources && npm run test:pinterest:dom && npm run test:pinterest:local-config && node --experimental-transform-types --test tests\/unit\/PortableWindowsPackage\.test\.ts && node scripts\/verify-windows-packaging\.mjs$/,
  );
});

test("Windows validation runs DOM tests as ESM and propagates native command failures", () => {
  assert.match(harnessSource, /pinterestUiModuleToHarnessScript/);
  assert.match(harnessSource, /Unexpected Pinterest UI ESM import in DOM harness/);
  assert.match(workflowTemplate, /- name: Run unit and Pinterest validation gates[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?npm test[\s\S]*?npm run test:pinterest:dom[\s\S]*?npm run test:pinterest:local-config/);
});

test("source-only test.3.4 template retains fail-closed Windows validation", () => {
  assert.match(test34WorkflowTemplate, /^name: Pinterest OAuth test\.3\.4 portable release$/m);
  assert.match(test34WorkflowTemplate, /tags:\n\s+- pinterest-oauth-test\.3\.4/);
  assert.match(test34WorkflowTemplate, /if: github\.ref == 'refs\/tags\/pinterest-oauth-test\.3\.4'/);
  assert.match(test34WorkflowTemplate, /ALIVO_PORTABLE_PACKAGE_SUFFIX: test\.3\.4/);
  assert.match(test34WorkflowTemplate, /- name: Run unit and Pinterest validation gates[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?npm test[\s\S]*?npm run test:pinterest:dom[\s\S]*?npm run test:pinterest:electron-windows[\s\S]*?npm run test:pinterest:local-config/);
});

test("source-only test.3.5 template retains fail-closed Windows validation", () => {
  assert.match(test35WorkflowTemplate, /^name: Pinterest OAuth test\.3\.5 portable release$/m);
  assert.match(test35WorkflowTemplate, /tags:\n\s+- pinterest-oauth-test\.3\.5/);
  assert.match(test35WorkflowTemplate, /if: github\.ref == 'refs\/tags\/pinterest-oauth-test\.3\.5'/);
  assert.match(test35WorkflowTemplate, /ALIVO_PORTABLE_PACKAGE_SUFFIX: test\.3\.5/);
  assert.match(test35WorkflowTemplate, /- name: Run unit and Pinterest validation gates[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?npm test[\s\S]*?npm run test:pinterest:dom[\s\S]*?npm run test:pinterest:electron-windows[\s\S]*?npm run test:pinterest:local-config/);
});

test("source-only test.3.6 template retains fail-closed Windows validation", () => {
  assert.match(test36WorkflowTemplate, /^name: Pinterest OAuth test\.3\.6 portable release$/m);
  assert.match(test36WorkflowTemplate, /tags:\n\s+- pinterest-oauth-test\.3\.6/);
  assert.match(test36WorkflowTemplate, /if: github\.ref == 'refs\/tags\/pinterest-oauth-test\.3\.6'/);
  assert.match(test36WorkflowTemplate, /ALIVO_PORTABLE_PACKAGE_SUFFIX: test\.3\.6/);
  assert.match(test36WorkflowTemplate, /- name: Run unit and Pinterest validation gates[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?npm test[\s\S]*?npm run test:pinterest:dom[\s\S]*?npm run test:pinterest:electron-windows[\s\S]*?npm run test:pinterest:local-config/);
});

test("source-only test.3.7 template retains fail-closed Windows validation", () => {
  assert.match(test37WorkflowTemplate, /^name: Pinterest OAuth test\.3\.7 portable release$/m);
  assert.match(test37WorkflowTemplate, /tags:\n\s+- pinterest-oauth-test\.3\.7/);
  assert.match(test37WorkflowTemplate, /if: github\.ref == 'refs\/tags\/pinterest-oauth-test\.3\.7'/);
  assert.match(test37WorkflowTemplate, /ALIVO_PORTABLE_PACKAGE_SUFFIX: test\.3\.7/);
  assert.match(test37WorkflowTemplate, /- name: Run unit and Pinterest validation gates[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?npm test[\s\S]*?npm run test:pinterest:dom[\s\S]*?npm run test:pinterest:electron-windows[\s\S]*?npm run test:pinterest:local-config/);
});

test("Windows Electron runner expects only the fail-closed reconfiguration state", () => {
  assert.match(electronRunnerSource, /const reconfiguredStatus = \{ ok: true, state: "ReauthorizationRequired", code: "SESSION_RECONFIGURED" \}/);
  assert.match(electronRunnerSource, /assert\.deepEqual\(trustedMainFrame, reconfiguredStatus\)/);
  assert.match(electronRunnerSource, /assert\.deepEqual\(afterBlockedNavigation, reconfiguredStatus\)/);
  assert.doesNotMatch(electronRunnerSource, /trustedMainFrame, \{ ok: true, state: "AuthenticationRequired" \}/);
});

test("Windows Electron runner uses a completed exact-frame event instead of polling frame lists", () => {
  assert.match(electronRunnerSource, /const \{ app, BrowserWindow, webFrameMain \} = require\("electron"\)/);
  assert.match(electronRunnerSource, /contents\.on\("did-frame-finish-load", onFrameFinished\)/);
  assert.match(electronRunnerSource, /const frame = webFrameMain\.fromId\(frameProcessId, frameRoutingId\)/);
  assert.match(electronRunnerSource, /if \(isMainFrame \|\| !frame \|\| frame\.url !== sourceUrl\) return/);
  assert.match(electronRunnerSource, /Timed out waiting for the exact foreign iframe load event/);
  assert.match(electronRunnerSource, /frameDiagnostics\(contents, sourceUrl, events\)/);
  assert.doesNotMatch(electronRunnerSource, /waitFor\("foreign iframe"/);
});

test("Windows Electron teardown waits for process close before retrying temporary userData cleanup", () => {
  assert.match(electronRunnerSource, /closeAllWindowsDeterministically/);
  assert.match(electronRunnerSource, /window\.close\(\)/);
  assert.match(electronRunnerSource, /app\.on\("before-quit", preventAutomaticQuit\)/);
  assert.match(electronRunnerSource, /app\.quit\(\)/);
  assert.match(electronWindowsTestSource, /child\.once\("close"/);
  assert.match(electronWindowsTestSource, /await removeTemporaryUserData\(temporaryUserData\)/);
  assert.ok(
    electronWindowsTestSource.indexOf('child.once("close"') < electronWindowsTestSource.indexOf("await removeTemporaryUserData(temporaryUserData)"),
  );
});

test("Electron iframe test mode cannot be enabled in a packaged application", () => {
  assert.match(electronMainSource, /!app\.isPackaged && process\.env\.ALIVO_PINTEREST_ELECTRON_INTEGRATION_TEST === "1"/);
  assert.match(electronMainSource, /ipcMain\.handle\("onboarding:complete", async \(_event\) => \{ assertTrustedPinterestSender\(_event, mainWindow, trustedUiPaths\)/);
});

test("Frozen specification digest remains byte-stable and line-ending fail-closed", () => {
  assert.match(attributes, /^\/docs\/ALIVO-OS_Specification_v1\.0\.md text eol=lf$/m);
  const specification = readFileSync(new URL("../../docs/ALIVO-OS_Specification_v1.0.md", import.meta.url));
  assert.equal(createHash("sha256").update(specification).digest("hex"), "417f06ea5bfbc1947a5cdc47a185f4240856ed1434d76a0f65e8fdc25207ff79");
  assert.match(auditSource, /if b"\\r\\n" in spec_bytes or b"\\r" in spec_bytes:/);
});