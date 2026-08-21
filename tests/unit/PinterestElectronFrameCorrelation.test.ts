import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFrameUrl, correlatesLoadedSubframe } from "../integration/pinterest-electron-frame-sync.cjs";

const expectedUrl = "file:///tmp/pinterest-ipc-integration-frame.html";
const matchingFrame = {
  url: expectedUrl,
};

test("canonicalizes frame URLs before correlation", () => {
  assert.equal(canonicalFrameUrl("https://example.test:443/frame"), "https://example.test/frame");
  assert.equal(canonicalFrameUrl("not a URL"), null);
});

test("correlates only the completed non-main frame with matching identity and URL", () => {
  const event = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: matchingFrame,
  };
  assert.equal(correlatesLoadedSubframe(event, expectedUrl), true);
  assert.equal(correlatesLoadedSubframe({ ...event, isMainFrame: true }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { ...matchingFrame, url: "file:///tmp/other.html" } }, expectedUrl), false);
});

test("rejects main frames, invalid event IDs, and missing frames instead of resolving", () => {
  const event = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: matchingFrame,
  };
  assert.equal(correlatesLoadedSubframe({ ...event, isMainFrame: true }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frameProcessId: Number.NaN }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frameProcessId: 1.5 }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frameProcessId: -1 }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frameRoutingId: -1 }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({
    isMainFrame: false,
    frameProcessId: 41,
    frameRoutingId: 73,
    frame: undefined,
  }, expectedUrl), false);
});

test("rejects a malformed or non-matching canonical URL", () => {
  const event = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: matchingFrame,
  };
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "not a URL" } }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "file:///tmp/other.html" } }, expectedUrl), false);
});