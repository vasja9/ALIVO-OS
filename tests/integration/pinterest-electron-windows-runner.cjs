"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, webFrameMain } = require("electron");
const { canonicalFrameUrl, correlateLoadedSubframe } = require("./pinterest-electron-frame-sync.cjs");
const { appendCleanupFailure } = require("./pinterest-electron-teardown.cjs");

const projectRoot = path.resolve(__dirname, "../..");
const resultPrefix = "PINTEREST_ELECTRON_TEST_RESULT=";
const testEnvironmentFlag = "ALIVO_PINTEREST_ELECTRON_INTEGRATION_TEST";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(description, predicate, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForMainFrameLoad(contents) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const fail = (_event, code, description, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`ALIVO UI failed to load (${code} ${description} ${url})`));
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out loading the ALIVO UI"));
    }, 10_000);
    contents.once("did-finish-load", finish);
    contents.once("did-fail-load", (_event, code, description, url) => {
      fail(_event, code, description, url);
    });
    if (!contents.isLoadingMainFrame()) finish();
  });
}

async function closeWindowDeterministically(window) {
  if (window.isDestroyed()) return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out closing the ALIVO UI window"));
    }, 10_000);
    window.once("closed", finish);
    window.close();
    if (window.isDestroyed()) finish();
  });
}

async function closeAllWindowsDeterministically() {
  for (const window of BrowserWindow.getAllWindows()) {
    await closeWindowDeterministically(window);
  }
  await waitFor("all ALIVO UI windows to close", () => BrowserWindow.getAllWindows().length === 0);
}

async function invokeInFrame(frame, expression) {
  return await frame.executeJavaScript(`Promise.resolve(${expression})`);
}

function diagnosticUrl(value) {
  const canonicalUrl = canonicalFrameUrl(value);
  if (!canonicalUrl) return "<invalid-url>";
  const url = new URL(canonicalUrl);
  if (url.protocol === "data:") return "data:<redacted>";
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function frameDiagnostics(contents, expectedUrl, events) {
  return JSON.stringify({
    expectedUrl: diagnosticUrl(expectedUrl),
    mainFrameUrl: diagnosticUrl(contents.getURL()),
    frames: [contents.mainFrame, ...contents.mainFrame.frames].map((frame) => ({
      url: diagnosticUrl(frame.url),
      processId: frame.processId,
      routingId: frame.routingId,
    })),
    events,
  });
}

async function addAndFindFrame(contents, sourceUrl) {
  const events = [];
  let settle;
  let settled = false;
  let timeout;
  const completed = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const cleanup = () => {
    clearTimeout(timeout);
    contents.removeListener("did-frame-finish-load", onFrameFinished);
    contents.removeListener("did-fail-load", onFrameFailed);
  };
  const settleOnce = (error, frame) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) {
      settle.reject(new Error(`${error}: ${frameDiagnostics(contents, sourceUrl, events)}`));
    } else {
      settle.resolve(frame);
    }
  };
  const fail = (message) => {
    settleOnce(`${message}`, undefined);
  };
  const onFrameFinished = (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    let frame;
    let lookupError;
    try {
      frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
    } catch (error) {
      lookupError = String(error?.message || error).slice(0, 160);
    }
    const correlation = !lookupError && correlateLoadedSubframe({
      isMainFrame,
      frameProcessId,
      frameRoutingId,
      frame,
    }, sourceUrl);
    events.push({
      event: "did-frame-finish-load",
      isMainFrame,
      frameProcessId,
      frameRoutingId,
      url: diagnosticUrl(frame?.url),
      correlated: correlation && correlation.correlated,
      predicates: correlation ? correlation.predicates : {
        isNonMainFrame: false,
        validProcessId: false,
        validRoutingId: false,
        framePresent: false,
        canonicalUrlMatch: false,
      },
      expected: correlation?.expected || diagnosticUrl(sourceUrl),
      observed: correlation?.observed || diagnosticUrl(frame?.url),
      ...(lookupError ? { lookupError } : {}),
    });
    if (!correlation || !correlation.correlated) return;
    settleOnce(undefined, frame);
  };
  const onFrameFailed = (_event, code, description, validatedUrl, isMainFrame, frameProcessId, frameRoutingId) => {
    events.push({
      event: "did-fail-load",
      isMainFrame,
      frameProcessId,
      frameRoutingId,
      code,
      description: String(description).slice(0, 160),
      url: diagnosticUrl(validatedUrl),
    });
    if (!isMainFrame && canonicalFrameUrl(validatedUrl) === canonicalFrameUrl(sourceUrl)) {
      fail(`Foreign iframe failed to load (${code} ${String(description).slice(0, 160)})`);
    }
  };
  timeout = setTimeout(
    () => fail("Timed out waiting for the exact foreign iframe load event"),
    10_000,
  );

  contents.on("did-frame-finish-load", onFrameFinished);
  contents.on("did-fail-load", onFrameFailed);
  try {
    const created = await contents.executeJavaScript(`
      (() => {
        const frame = document.createElement("iframe");
        frame.id = "pinterest-ipc-integration-frame";
        frame.src = ${JSON.stringify(sourceUrl)};
        document.body.append(frame);
        return { id: frame.id, src: frame.src };
      })()
    `);
    if (
      !created ||
      created.id !== "pinterest-ipc-integration-frame" ||
      canonicalFrameUrl(created.src) !== canonicalFrameUrl(sourceUrl)
    ) {
      fail("Foreign iframe creation did not retain the requested URL");
    }
  } catch (error) {
    fail(`Foreign iframe creation failed (${String(error?.message || error).slice(0, 160)})`);
  }
  return await completed;
}

async function verifyNavigationIsBlocked(contents) {
  const originalUrl = contents.getURL();
  const attemptedUrl = "https://foreign-pinterest-frame.invalid/";
  const navigation = new Promise((resolve) => contents.once("will-navigate", (_event, url) => resolve(url)));
  await contents.executeJavaScript(`window.location.assign(${JSON.stringify(attemptedUrl)})`);
  assert.equal(await navigation, attemptedUrl);
  await sleep(50);
  assert.equal(contents.getURL(), originalUrl);
}

async function run() {
  if (process.platform !== "win32") throw new Error("Windows Electron integration runner was started outside Windows");
  if (process.env[testEnvironmentFlag] !== "1") throw new Error("Windows Electron integration test flag is required");
  const temporaryAppData = process.env.ALIVO_PINTEREST_ELECTRON_TEST_USER_DATA;
  if (!temporaryAppData || !path.win32.isAbsolute(temporaryAppData)) {
    throw new Error("Windows Electron integration test userData path is required");
  }

  app.disableHardwareAcceleration();
  app.setPath("appData", temporaryAppData);
  require(path.join(projectRoot, "electron", "main.cjs"));
  const preventAutomaticQuit = (event) => event.preventDefault();
  app.on("before-quit", preventAutomaticQuit);

  let scenarioError;
  try {
    await app.whenReady();
    const window = await waitFor("ALIVO BrowserWindow", () => BrowserWindow.getAllWindows()[0]);
    const contents = window.webContents;
    await waitForMainFrameLoad(contents);

    const configured = await invokeInFrame(
      contents.mainFrame,
      `window.alivoPinterestLocalConfig.save({
        clientId: "integration-test-client",
        clientSecret: "integration-test-secret",
        redirectUri: "http://localhost:48123/pinterest/oauth/callback",
      })`,
    );
    assert.equal(configured.ok, true);

    const reconfiguredStatus = { ok: true, state: "ReauthorizationRequired", code: "SESSION_RECONFIGURED" };
    const trustedMainFrame = await invokeInFrame(contents.mainFrame, "window.alivoPinterest.connectionStatus()");
    assert.deepEqual(trustedMainFrame, reconfiguredStatus);

    const trustedLocalIframeUrl = pathToFileURL(path.join(projectRoot, "ui", "index.html"));
    trustedLocalIframeUrl.hash = "pinterest?view=overview";
    const trustedLocalIframe = await addAndFindFrame(contents, trustedLocalIframeUrl.href);
    const trustedLocalIframeResult = await invokeInFrame(trustedLocalIframe, "window.alivoPinterest.connectionStatus()");
    assert.deepEqual(
      trustedLocalIframeResult,
      { ok: false, code: "PINTEREST_STATUS_UNAVAILABLE", state: "AuthenticationRequired", message: "Pinterest connection status is unavailable" },
    );

    const dataIframe = await addAndFindFrame(
      contents,
      "data:text/html,%3C!doctype%20html%3E%3Ctitle%3Eforeign%3C/title%3E",
    );
    const dataIframeResult = await invokeInFrame(dataIframe, "window.alivoPinterest.connectionStatus()");
    assert.deepEqual(
      dataIframeResult,
      { ok: false, code: "PINTEREST_STATUS_UNAVAILABLE", state: "AuthenticationRequired", message: "Pinterest connection status is unavailable" },
    );

    await verifyNavigationIsBlocked(contents);
    const afterBlockedNavigation = await invokeInFrame(contents.mainFrame, "window.alivoPinterest.connectionStatus()");
    assert.deepEqual(afterBlockedNavigation, reconfiguredStatus);
  } catch (error) {
    scenarioError = error;
  } finally {
    let teardownError;
    try {
      await closeAllWindowsDeterministically();
    } catch (error) {
      teardownError = error;
    } finally {
      app.removeListener("before-quit", preventAutomaticQuit);
    }
    if (scenarioError && teardownError) throw appendCleanupFailure(scenarioError, teardownError);
    if (teardownError) throw teardownError;
  }
  if (scenarioError) throw scenarioError;
}

run()
  .then(() => {
    process.stdout.write(`${resultPrefix}${JSON.stringify({ ok: true })}\n`);
    app.quit();
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
    app.quit();
  });
