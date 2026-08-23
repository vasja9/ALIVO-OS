"use strict";

function createPinterestLifecycle({
  resolveConfiguration,
  createRuntime,
  createComposition,
  clearSessionFile,
} = {}) {
  if (typeof resolveConfiguration !== "function") throw new TypeError("resolveConfiguration is required");
  if (typeof createRuntime !== "function") throw new TypeError("createRuntime is required");
  if (typeof createComposition !== "function") throw new TypeError("createComposition is required");
  if (typeof clearSessionFile !== "function") throw new TypeError("clearSessionFile is required");

  let runtime;
  let composition;
  let configurationGeneration = 0;
  let requiresReauthorization = false;
  let lifecycleTail = Promise.resolve();

  function serialize(operation) {
    const previous = lifecycleTail;
    let release;
    lifecycleTail = new Promise((resolve) => { release = resolve; });
    return previous.then(operation, operation).finally(release);
  }

  async function currentRuntime() {
    if (!runtime) {
      const configuration = await resolveConfiguration();
      const generation = configurationGeneration;
      runtime = createRuntime({
        configuration,
        configurationGeneration: generation,
        isConfigurationCurrent: () => generation === configurationGeneration,
      });
    }
    return runtime;
  }

  async function currentComposition() {
    if (!composition) composition = createComposition(await currentRuntime());
    return composition;
  }

  async function retireRuntime() {
    configurationGeneration += 1;
    const previousRuntime = runtime;
    runtime = undefined;
    composition = undefined;
    if (previousRuntime) await previousRuntime.close();
  }

  return Object.freeze({
    startAuthorization: (input) => serialize(async () => (await currentRuntime()).startAuthorization(input)),
    status: (credentialId) => serialize(async () => {
      const result = await (await currentRuntime()).status(credentialId);
      if (["AuthenticationRequired", "ReauthorizationRequired"].includes(result.state)) composition?.clearAccountPerformance?.();
      if (result.state === "Authenticated") requiresReauthorization = false;
      if (requiresReauthorization && result.state === "AuthenticationRequired") {
        return Object.freeze({ state: "ReauthorizationRequired", code: "SESSION_RECONFIGURED" });
      }
      return result;
    }),
    verifyConnection: (input) => serialize(async () => (await currentComposition()).verifyConnection(input)),
    readObservation: (input) => serialize(async () => (await currentComposition()).readObservation(input)),
    readAccountPerformance: (input) => serialize(async () => (await currentComposition()).readAccountPerformance(input)),
    readTopPins: (input) => serialize(async () => (await currentComposition()).readTopPins(input)),
    readPerformance: (input) => serialize(async () => (await currentComposition()).readPerformance(input)),
    reconfigure: (change) => serialize(async () => {
      if (typeof change !== "function") throw new TypeError("reconfiguration change is required");
      await retireRuntime();
      const result = await change();
      await clearSessionFile();
      requiresReauthorization = result?.configured === true;
      return result;
    }),
    generation: () => configurationGeneration,
  });
}

module.exports = { createPinterestLifecycle };
