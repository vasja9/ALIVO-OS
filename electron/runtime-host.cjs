const path = require("node:path");
const fs = require("node:fs/promises");
const { createCredentialStore } = require("./credential-store.cjs");

function createRuntimeHost(app, safeStorage) {
  const userData = app.getPath("userData");
  const onboardingPath = path.join(userData, "state", "onboarding.json");
  const credentials = createCredentialStore(app, safeStorage);
  let runtimeLoaded = false;
  let runtimeError = null;

  async function initialize() {
    try {
      const modulePath = path.join(__dirname, "../build/runtime/deployment/FirstRunOnboarding.js");
      await import(modulePath);
      runtimeLoaded = true;
      runtimeError = null;
    } catch (error) {
      runtimeLoaded = false;
      runtimeError = error instanceof Error ? error.message : String(error);
    }
  }

  async function readOnboardingState() {
    try {
      return JSON.parse(await fs.readFile(onboardingPath, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async function writeOnboardingState(next) {
    await fs.mkdir(path.dirname(onboardingPath), { recursive: true });
    const tmp = `${onboardingPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, onboardingPath);
  }

  async function recordIntegration(kind, summary) {
    const current = (await readOnboardingState()) || { schemaVersion: 1, completed: true };
    await writeOnboardingState({ ...current, [kind]: summary });
  }

  async function status() {
    const onboarding = await readOnboardingState();
    return {
      state: runtimeLoaded ? "Connected" : "Unavailable",
      runtimeLoaded,
      runtimeError,
      persistentDataDirectory: userData,
      onboarding: onboarding
        ? { schemaVersion: onboarding.schemaVersion, completed: onboarding.completed === true }
        : { completed: false },
    };
  }

  async function integrations() {
    const onboarding = await readOnboardingState();
    const summary = (value) => ({
      state: value?.state || "Not Configured",
      safeIdentity: value?.safeIdentity,
      checkedAt: value?.checkedAt,
    });
    return {
      businessPackageId: "ALIVO",
      wordpress: summary(onboarding?.wordpress),
      pinterest: summary(onboarding?.pinterest),
      analyticsConfigured: onboarding?.analyticsConfigured === true,
    };
  }

  async function openAuthentication(integration) {
    if (!integration || typeof integration !== "string") {
      return { state: "Configuration Invalid", message: "Integration identity is required." };
    }
    const normalized = integration.toLowerCase();
    if (!["wordpress", "pinterest"].includes(normalized)) {
      return { state: "Unsupported", message: `${integration} does not yet have a desktop authentication flow.` };
    }
    return { state: "Opened", integration: normalized };
  }

  function classifyHttp(statusCode) {
    if (statusCode === 401) return "Invalid Credential";
    if (statusCode === 403) return "Permission Denied";
    if (statusCode === 429) return "Rate Limited";
    return statusCode >= 500 ? "Unavailable" : "Configuration Invalid";
  }

  async function timedFetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  async function verifyWordPress(input) {
    const site = String(input?.site || "").trim().replace(/\/$/, "");
    const username = String(input?.username || "").trim();
    const applicationPassword = String(input?.applicationPassword || "");
    if (!site.startsWith("https://") || !username || !applicationPassword) {
      return { state: "Configuration Invalid", message: "HTTPS site, username and Application Password are required." };
    }
    try {
      const auth = Buffer.from(`${username}:${applicationPassword}`, "utf8").toString("base64");
      const response = await timedFetch(`${site}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
      if (!response.ok) return { state: classifyHttp(response.status), message: `WordPress verification returned HTTP ${response.status}.` };
      const user = await response.json();
      const safeIdentity = user?.name || user?.slug || username;
      await credentials.put("wordpress", { site, username, applicationPassword });
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString() };
      await recordIntegration("wordpress", summary);
      return { ...summary, message: "WordPress connection verified. No content was published." };
    } catch (error) {
      const state = error?.name === "AbortError" ? "Unavailable" : "Site Unreachable";
      return { state, message: error?.name === "AbortError" ? "WordPress verification timed out." : "WordPress site could not be reached securely." };
    }
  }

  async function verifyPinterest(input) {
    const accessToken = String(input?.accessToken || "").trim();
    if (!accessToken) return { state: "Configuration Invalid", message: "Pinterest access token is required." };
    try {
      const response = await timedFetch("https://api.pinterest.com/v5/user_account", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
      if (!response.ok) return { state: classifyHttp(response.status), message: `Pinterest verification returned HTTP ${response.status}.` };
      const account = await response.json();
      const safeIdentity = account?.username || account?.business_name || "Pinterest account";
      await credentials.put("pinterest", { accessToken });
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString() };
      await recordIntegration("pinterest", summary);
      return { ...summary, message: "Pinterest connection verified against the account endpoint. No Pin was created." };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest verification timed out." : "Pinterest API could not be reached." };
    }
  }

  async function verifyAuthentication(request = {}) {
    if (request.businessPackageId && request.businessPackageId !== "ALIVO") return { state: "ScopeMismatch", message: "Authentication request is outside ALIVO scope." };
    if (request.integration === "wordpress") return verifyWordPress(request.values);
    if (request.integration === "pinterest") return verifyPinterest(request.values);
    return { state: "Unsupported", message: "This integration does not yet support desktop verification." };
  }

  async function settingsRead(request = {}) {
    if (request.businessPackageId && request.businessPackageId !== "ALIVO") {
      return { state: "ScopeMismatch", businessPackageId: "ALIVO" };
    }
    return {
      state: runtimeLoaded ? "Connected" : "Unavailable",
      businessPackageId: "ALIVO",
      integrations: await integrations(),
      runtime: await status(),
    };
  }

  async function settingsCommand(request = {}) {
    return {
      state: "Unavailable",
      message: `Governed Settings command '${request.command || "Unknown"}' is not connected to a production command gateway yet. No configuration was changed.`,
    };
  }

  async function systemCommand(request = {}) {
    return {
      state: "Unavailable",
      message: `Governed System command '${request.command || "Unknown"}' is not connected to a production command gateway yet. No operation was executed.`,
    };
  }

  return Object.freeze({ initialize, status, integrations, openAuthentication, verifyAuthentication, settingsRead, settingsCommand, systemCommand });
}

module.exports = { createRuntimeHost };
