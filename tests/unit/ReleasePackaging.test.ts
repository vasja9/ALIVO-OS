import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface PackageManifest {
  version: string;
  build?: {
    artifactName?: string;
    directories?: { output?: string };
    win?: { target?: Array<{ target?: string; arch?: string[] }> };
  };
}

test("release packaging produces the governed Windows x64 Setup identity", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;

  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.build?.artifactName, "ALIVO-OS-v${version}-Setup.${ext}");
  assert.equal(manifest.build?.directories?.output, "dist");
  assert.deepEqual(manifest.build?.win?.target, [
    { target: "nsis", arch: ["x64"] },
  ]);
});
