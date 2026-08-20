import assert from "node:assert/strict";
import test from "node:test";

import {
  findForbiddenPackageLockUrls,
  findForbiddenTrackedReferences,
  isForbiddenResolvedUrl,
} from "../../scripts/verify-public-package-sources.mjs";

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