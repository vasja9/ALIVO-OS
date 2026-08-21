import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFrameUrl, correlateLoadedSubframe, correlatesLoadedSubframe } from "../integration/pinterest-electron-frame-sync.cjs";

const expectedUrl = "file:///tmp/pinterest-ipc-integration-frame.html";
const matchingFrame = {
  url: expectedUrl,
};

test("canonicalizes frame URLs before correlation", () => {
  assert.equal(canonicalFrameUrl("https://example.test:443/frame"), "https://example.test/frame");
  assert.equal(canonicalFrameUrl("not a URL"), null);
});

test("correlates a resolved subframe from event IDs without re-checking WebFrameMain ID properties", () => {
  const event = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: matchingFrame,
  };
  assert.equal(correlatesLoadedSubframe(event, expectedUrl), true);
  assert.deepEqual(correlateLoadedSubframe(event, expectedUrl).predicates, {
    isNonMainFrame: true,
    validProcessId: true,
    validRoutingId: true,
    framePresent: true,
    canonicalUrlMatch: true,
  });
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

test("accepts equivalent Windows file URL forms but preserves search and hash", () => {
  const windowsEvent = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: { url: "file://LOCALHOST/C:/ALIVO/UI/../ui/index.html?mode=1#ready" },
  };
  assert.equal(
    correlatesLoadedSubframe(windowsEvent, "file:///c:/alivo/ui/index.html?mode=1#ready"),
    true,
  );
  assert.equal(
    correlatesLoadedSubframe({ ...windowsEvent, frame: { url: "file:///D:/alivo/ui/index.html?mode=1#ready" } }, "file:///c:/alivo/ui/index.html?mode=1#ready"),
    false,
  );
  assert.equal(
    correlatesLoadedSubframe({ ...windowsEvent, frame: { url: "file:///c:/alivo/other.html?mode=1#ready" } }, "file:///c:/alivo/ui/index.html?mode=1#ready"),
    false,
  );
  assert.equal(
    correlatesLoadedSubframe({ ...windowsEvent, frame: { url: "file:///c:/alivo/ui/index.html?mode=2#ready" } }, "file:///c:/alivo/ui/index.html?mode=1#ready"),
    false,
  );
  assert.equal(
    correlatesLoadedSubframe({ ...windowsEvent, frame: { url: "file:///c:/alivo/ui/index.html?mode=1#other" } }, "file:///c:/alivo/ui/index.html?mode=1#ready"),
    false,
  );
});

test("rejects a malformed, non-file, or non-matching URL", () => {
  const event = {
    isMainFrame: false,
    frameProcessId: 4,
    frameRoutingId: 4,
    frame: matchingFrame,
  };
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "not a URL" } }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "file:///tmp/other.html" } }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "data:text/html,frame" } }, expectedUrl), false);
  assert.equal(correlatesLoadedSubframe({ ...event, frame: { url: "file://foreign-host/tmp/frame.html" } }, expectedUrl), false);
});