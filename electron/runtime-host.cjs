const path = require("node:path");
const fs = require("node:fs/promises");

function createRuntimeHost(app) {
  const userData = app.getPath("userData");
  const onboardingPath = path.join(userData, "state", "onboarding.json");
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
    return {
      state: "Configuration Required",
      integration,
      route: "#settings/integrations",
      message: `${integration} authentication must be completed in the governed Settings authentication flow.`,
    };
  }

  return Object.freeze({ initialize, status, integrations, openAuthentication });
}

module.exports = { createRuntimeHost };
