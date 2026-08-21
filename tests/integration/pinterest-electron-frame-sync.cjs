"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

function canonicalizeUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol === "file:") {
    if (parsed.host !== "" && parsed.host.toLowerCase() !== "localhost") return null;
    let filePath;
    try {
      filePath = fileURLToPath(parsed);
    } catch {
      return null;
    }
    if (/^\/[A-Za-z]:[\\/]/.test(filePath)) filePath = filePath.slice(1);
    const windowsPath = path.win32.resolve(path.win32.normalize(filePath));
    if (windowsPath.startsWith("\\\\")) return null;
    const canonicalPath = windowsPath.replace(/\\/g, "/").toLowerCase();
    const href = `${new URL(`file:///${canonicalPath.replace(/^\/+/, "")}`).href}${parsed.search}${parsed.hash}`;
    return { href, protocol: "file:", host: "", path: canonicalPath, search: parsed.search, hash: parsed.hash };
  }

  return {
    href: parsed.href,
    protocol: parsed.protocol,
    host: parsed.host,
    path: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
}

function canonicalFrameUrl(value) {
  return canonicalizeUrl(value)?.href || null;
}

function diagnosticCanonicalUrl(value) {
  const canonical = canonicalizeUrl(value);
  if (!canonical) return { valid: false, protocol: null, host: null, path: null, search: null, hash: null };
  if (canonical.protocol === "data:") {
    return { valid: true, protocol: canonical.protocol, host: canonical.host, path: "data:<redacted>", search: "<redacted>", hash: "<redacted>" };
  }
  return {
    valid: true,
    protocol: canonical.protocol,
    host: canonical.host,
    path: canonical.path,
    search: canonical.search,
    hash: canonical.hash,
  };
}

function correlateLoadedSubframe({ isMainFrame, frameProcessId, frameRoutingId, frame }, expectedUrl) {
  const canonicalExpectedUrl = canonicalFrameUrl(expectedUrl);
  const canonicalObservedUrl = canonicalFrameUrl(frame?.url);
  const predicates = {
    isNonMainFrame: isMainFrame === false,
    validProcessId: Number.isInteger(frameProcessId) && frameProcessId >= 0,
    validRoutingId: Number.isInteger(frameRoutingId) && frameRoutingId >= 0,
    framePresent: frame !== null && frame !== undefined,
    canonicalUrlMatch: canonicalObservedUrl !== null && canonicalObservedUrl === canonicalExpectedUrl,
  };
  return {
    correlated: Object.values(predicates).every(Boolean),
    predicates,
    expected: diagnosticCanonicalUrl(expectedUrl),
    observed: diagnosticCanonicalUrl(frame?.url),
  };
}

function correlatesLoadedSubframe(event, expectedUrl) {
  return correlateLoadedSubframe(event, expectedUrl).correlated;
}

module.exports = {
  canonicalFrameUrl,
  correlateLoadedSubframe,
  correlatesLoadedSubframe,
  diagnosticCanonicalUrl,
};