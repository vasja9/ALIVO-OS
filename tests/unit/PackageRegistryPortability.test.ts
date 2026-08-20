import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  findForbiddenPackageLockUrls,
  findForbiddenTrackedReferences,
  isForbiddenResolvedUrl,
} from "../../scripts/verify-public-package-sources.mjs";

const validatorPath = resolve("scripts/verify-public-package-sources.mjs");

test("validator entrypoint executes as a standalone Node process", () => {
  const result = spawnSync(process.execPath, [validatorPath], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Public package source validation passed\./);
});

test("public npm tarballs remain portable", () => {
  assert.equal(
    isForbiddenResolvedUrl("https://registry.npmjs.org/electron/-/electron-39.8.10.tgz"),
    false,
  );
  assert.deepEqual(
    findForbiddenPackageLockUrls({
      packages: {
        "node_modules/electron": {
          resolved: "https://registry.npmjs.org/electron/-/electron-39.8.10.tgz",
        },
      },
    }),
    [],
  );
});

test("standalone validator fails closed for a tracked internal package source", () => {
  const temporaryRepository = mkdtempSync(resolve(tmpdir(), "alivo-public-package-sources-"));
  const firewallUrl = `http://${["package-firewall", "replit", "local"].join(".")}/npm/example/-/example-1.0.0.tgz`;

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: temporaryRepository });
    writeFileSync(
      resolve(temporaryRepository, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/example": { resolved: firewallUrl },
        },
      }),
    );
    execFileSync("git", ["add", "package-lock.json"], { cwd: temporaryRepository });

    const result = spawnSync(process.execPath, [validatorPath], {
      cwd: temporaryRepository,
      encoding: "utf8",
    });

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Forbidden internal package source detected:/);
    assert.match(result.stderr, /package-lock\.json: node_modules\/example:/);
  } finally {
    rmSync(temporaryRepository, { recursive: true, force: true });
  }
});

test("internal registry sources fail closed", () => {
  const firewallUrl = `http://${["package-firewall", "replit", "local"].join(".")}/npm/electron/-/electron-39.8.10.tgz`;
  const localhostRegistryUrl = ["http://", "localhost:4873/npm/electron/-/electron-39.8.10.tgz"].join("");
  const otherInternalUrl = `https://${["registry", "internal", "example"].join(".")}/npm/electron/-/electron-39.8.10.tgz`;
  assert.equal(
    isForbiddenResolvedUrl(firewallUrl),
    true,
  );
  assert.equal(
    isForbiddenResolvedUrl(localhostRegistryUrl),
    true,
  );
  assert.equal(isForbiddenResolvedUrl(otherInternalUrl), true);
  assert.deepEqual(
    findForbiddenPackageLockUrls({
      packages: {
        "node_modules/electron": {
          resolved: firewallUrl,
        },
      },
    }),
    [`node_modules/electron: ${firewallUrl}`],
  );
  assert.deepEqual(
    findForbiddenTrackedReferences(`registry=${localhostRegistryUrl}`),
    [`line 1: registry=${localhostRegistryUrl}`],
  );
  assert.deepEqual(
    findForbiddenTrackedReferences(`npm_config_registry=${otherInternalUrl}`),
    [`line 1: npm_config_registry=${otherInternalUrl}`],
  );
});