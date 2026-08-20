#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const loopbackPackageUrlPattern = /https?:\/\/(?:localhost|127(?:\.0){3}|0\.0\.0\.0)(?::\d+)?\/(?:npm|registry)(?:\/|$)/i;
const replitPackageUrlPattern = /https?:\/\/(?:[a-z0-9-]+\.)*replit\.(?:local|dev|com)(?::\d+)?\/(?:npm|registry)(?:\/|$)/i;
const registryAssignmentPattern = /(?:^|[\s"'`])(?:npm_config_)?registry\s*[=:]\s*["']?(https?:\/\/[^\s"'`]+)/i;

export function isForbiddenResolvedUrl(value) {
  if (typeof value !== "string") return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol !== "https:" || url.hostname.toLowerCase() !== "registry.npmjs.org";
}

export function findForbiddenPackageLockUrls(packageLock) {
  return Object.entries(packageLock.packages ?? {})
    .flatMap(([packagePath, metadata]) => (
      isForbiddenResolvedUrl(metadata?.resolved)
        ? [`${packagePath}: ${metadata.resolved}`]
        : []
    ));
}

export function findForbiddenTrackedReferences(source) {
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const registryAssignment = line.match(registryAssignmentPattern);
      const forbidden = (
        loopbackPackageUrlPattern.test(line) ||
        replitPackageUrlPattern.test(line) ||
        (registryAssignment && isForbiddenResolvedUrl(registryAssignment[1]))
      );
      return forbidden ? [`line ${index + 1}: ${line.trim()}`] : [];
    });
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function readText(path) {
  const contents = readFileSync(resolve(path));
  return contents.includes(0) ? null : contents.toString("utf8");
}

function main() {
  const failures = [];
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));

  for (const failure of findForbiddenPackageLockUrls(packageLock)) {
    failures.push(`package-lock.json: ${failure}`);
  }

  for (const path of trackedFiles()) {
    const source = readText(path);
    if (!source) continue;
    for (const failure of findForbiddenTrackedReferences(source)) {
      failures.push(`${path}: ${failure}`);
    }
  }

  if (failures.length > 0) {
    console.error("Forbidden internal package source detected:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Public package source validation passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main();
}