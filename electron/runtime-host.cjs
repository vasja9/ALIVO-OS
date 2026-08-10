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
      authMode: value?.authMode,
      expiresAt: value?.expiresAt,
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
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString(), authMode: "application-password" };
      await recordIntegration("wordpress", summary);
      return { ...summary, message: "WordPress connection verified. No content was published." };
    } catch (error) {
      const state = error?.name === "AbortError" ? "Unavailable" : "Site Unreachable";
      return { state, message: error?.name === "AbortError" ? "WordPress verification timed out." : "WordPress site could not be reached securely." };
    }
  }

  async function pinterestAccount(accessToken) {
    const response = await timedFetch("https://api.pinterest.com/v5/user_account", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!response.ok) return { error: { state: classifyHttp(response.status), message: `Pinterest verification returned HTTP ${response.status}.` } };
    return { account: await response.json() };
  }

  async function verifyPinterest(input) {
    const accessToken = String(input?.accessToken || "").trim();
    if (!accessToken) return { state: "Configuration Invalid", message: "Pinterest access token is required." };
    try {
      const checked = await pinterestAccount(accessToken);
      if (checked.error) return checked.error;
      const safeIdentity = checked.account?.username || checked.account?.business_name || "Pinterest account";
      await credentials.put("pinterest", { accessToken, authMode: "temporary-token" });
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString(), authMode: "temporary-token" };
      await recordIntegration("pinterest", summary);
      return { ...summary, message: "Pinterest connection verified against the account endpoint. No Pin was created." };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest verification timed out." : "Pinterest API could not be reached." };
    }
  }

  async function requestPinterestToken(appId, appSecret, body) {
    const auth = Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64");
    const response = await timedFetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
    });
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) return { error: { state: classifyHttp(response.status), message: `Pinterest OAuth token exchange returned HTTP ${response.status}.` } };
    return { payload };
  }

  async function completePinterestOAuth(input = {}) {
    const appId = String(input.appId || "").trim();
    const appSecret = String(input.appSecret || "").trim();
    const code = String(input.code || "").trim();
    const redirectUri = String(input.redirectUri || "").trim();
    if (!appId || !appSecret || !code || !redirectUri) return { state: "Configuration Invalid", message: "Pinterest App ID, App secret, redirect URI and authorization code are required." };
    try {
      const token = await requestPinterestToken(appId, appSecret, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
      if (token.error) return token.error;
      const p = token.payload;
      if (!p.access_token || !p.refresh_token) return { state: "Configuration Invalid", message: "Pinterest OAuth response did not include refreshable credentials." };
      const checked = await pinterestAccount(p.access_token);
      if (checked.error) return checked.error;
      const now = Date.now();
      const expiresAt = new Date(now + Number(p.expires_in || 2592000) * 1000).toISOString();
      const refreshExpiresAt = p.refresh_token_expires_at
        ? new Date(Number(p.refresh_token_expires_at) * 1000).toISOString()
        : new Date(now + Number(p.refresh_token_expires_in || 5184000) * 1000).toISOString();
      const safeIdentity = checked.account?.username || checked.account?.business_name || "Pinterest account";
      await credentials.put("pinterest-oauth", {
        appId, appSecret, accessToken: p.access_token, refreshToken: p.refresh_token,
        expiresAt, refreshExpiresAt, scope: p.scope || "", redirectUri,
      });
      await credentials.remove("pinterest");
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString(), authMode: "oauth", expiresAt };
      await recordIntegration("pinterest", summary);
      return { ...summary, message: "Pinterest OAuth connection verified and refreshable credentials were stored securely." };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest OAuth exchange timed out." : "Pinterest OAuth exchange could not be completed." };
    }
  }

  async function maintainPinterestOAuth(force = false) {
    const saved = await credentials.get("pinterest-oauth");
    if (!saved?.refreshToken || !saved?.appId || !saved?.appSecret) return { state: "Not Configured" };
    const expiresAt = Date.parse(saved.expiresAt || 0);
    const refreshThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (!force && Number.isFinite(expiresAt) && expiresAt > refreshThreshold) return { state: "Connected", refreshed: false, expiresAt: saved.expiresAt };
    try {
      const token = await requestPinterestToken(saved.appId, saved.appSecret, { grant_type: "refresh_token", refresh_token: saved.refreshToken });
      if (token.error) return token.error;
      const p = token.payload;
      if (!p.access_token || !p.refresh_token) return { state: "Reauthorization Required", message: "Pinterest refresh response did not include continuous refresh credentials." };
      const now = Date.now();
      const next = {
        ...saved,
        accessToken: p.access_token,
        refreshToken: p.refresh_token,
        expiresAt: new Date(now + Number(p.expires_in || 2592000) * 1000).toISOString(),
        refreshExpiresAt: p.refresh_token_expires_at
          ? new Date(Number(p.refresh_token_expires_at) * 1000).toISOString()
          : new Date(now + Number(p.refresh_token_expires_in || 5184000) * 1000).toISOString(),
        scope: p.scope || saved.scope || "",
      };
      await credentials.put("pinterest-oauth", next);
      const checked = await pinterestAccount(next.accessToken);
      if (checked.error) return checked.error;
      const safeIdentity = checked.account?.username || checked.account?.business_name || "Pinterest account";
      const summary = { state: "Connected", safeIdentity, checkedAt: new Date().toISOString(), authMode: "oauth", expiresAt: next.expiresAt };
      await recordIntegration("pinterest", summary);
      return { ...summary, refreshed: true };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest token refresh timed out." : "Pinterest token refresh failed." };
    }
  }

  async function getPinterestAccessToken() {
    const maintained = await maintainPinterestOAuth(false);
    if (maintained.state === "Connected") {
      const saved = await credentials.get("pinterest-oauth");
      return saved?.accessToken;
    }
    const temporary = await credentials.get("pinterest");
    return temporary?.accessToken;
  }

  async function verifyAuthentication(request = {}) {
    if (request.businessPackageId && request.businessPackageId !== "ALIVO") return { state: "ScopeMismatch", message: "Authentication request is outside ALIVO scope." };
    if (request.integration === "wordpress") return verifyWordPress(request.values);
    if (request.integration === "pinterest") return verifyPinterest(request.values);
    return { state: "Unsupported", message: "This integration does not yet support desktop verification." };
  }

  async function settingsRead(request = {}) {
    if (request.businessPackageId && request.businessPackageId !== "ALIVO") return { state: "ScopeMismatch", businessPackageId: "ALIVO" };
    return { state: runtimeLoaded ? "Connected" : "Unavailable", businessPackageId: "ALIVO", integrations: await integrations(), runtime: await status() };
  }

  async function settingsCommand(request = {}) {
    return { state: "Unavailable", message: `Governed Settings command '${request.command || "Unknown"}' is not connected to a production command gateway yet. No configuration was changed.` };
  }

  async function systemCommand(request = {}) {
    return { state: "Unavailable", message: `Governed System command '${request.command || "Unknown"}' is not connected to a production command gateway yet. No operation was executed.` };
  }

  return Object.freeze({
    initialize, status, integrations, openAuthentication, verifyAuthentication,
    completePinterestOAuth, maintainPinterestOAuth, getPinterestAccessToken,
    settingsRead, settingsCommand, systemCommand,
  });
}

module.exports = { createRuntimeHost };
