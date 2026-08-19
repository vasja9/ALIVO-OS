import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");
const replit = readFileSync(new URL("../../.replit", import.meta.url), "utf8");

test("Pinterest DOM integration has a direct Node transform gate", () => {
  assert.equal(
    packageJson.scripts["test:pinterest:dom"],
    "node --experimental-transform-types --test tests/unit/PinterestDomIntegration.test.ts",
  );
  assert.match(makefile, /^pinterest-dom:\n\tnpm run test:pinterest:dom$/m);
  assert.match(replit, /name = "pinterest-dom"[\s\S]*?args = "npm run test:pinterest:dom"[\s\S]*?isValidation = true/);
});

test("Pinterest DOM gate fails closed before Windows package verification", () => {
  assert.match(
    packageJson.scripts["package:verify"],
    /^npm run test:pinterest:dom && npm run test:pinterest:local-config && node --experimental-transform-types --test tests\/unit\/PortableWindowsPackage\.test\.ts && node scripts\/verify-windows-packaging\.mjs$/,
  );
});