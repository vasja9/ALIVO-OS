"use strict";

function canonicalFrameUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function correlatesLoadedSubframe({ isMainFrame, frameProcessId, frameRoutingId, frame }, expectedUrl) {
  const canonicalExpectedUrl = canonicalFrameUrl(expectedUrl);
  const canonicalObservedUrl = canonicalFrameUrl(frame?.url);
  return isMainFrame === false
    && Number.isInteger(frameProcessId)
    && Number.isInteger(frameRoutingId)
    && frameProcessId === frame?.processId
    && frameRoutingId === frame?.routingId
    && canonicalObservedUrl !== null
    && canonicalObservedUrl === canonicalExpectedUrl;
}

module.exports = {
  canonicalFrameUrl,
  correlatesLoadedSubframe,
};