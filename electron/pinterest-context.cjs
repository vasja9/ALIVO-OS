"use strict";

const DEFAULT_BUSINESS_PACKAGE_ID = "ALIVO";

function createPinterestContextResolver(environment = process.env) {
  const businessPackageId = environment.ALIVO_PINTEREST_BUSINESS_PACKAGE_ID || DEFAULT_BUSINESS_PACKAGE_ID;
  const credentialId = environment.ALIVO_PINTEREST_CREDENTIAL_ID || `credential:pinterest:${businessPackageId.toLowerCase()}`;
  const allowedCapabilities = new Set(["AnalyticsObservation", "MarketObservation", "OwnBoards", "OwnPins", "PerformanceObservation", "TrendObservation"]);

  function resolve(request = {}) {
    const requestedPackage = request.businessPackageId?.value || request.businessPackageId;
    const requestedCredential = request.credentialId?.value || request.credentialId;
    if (requestedPackage !== undefined && requestedPackage !== businessPackageId) throw new Error("Pinterest Business Package is not authorized");
    if (requestedCredential !== undefined && requestedCredential !== credentialId) throw new Error("Pinterest credential is not authorized");
    const requestedCapabilities = request.requestedCapabilities;
    if (requestedCapabilities !== undefined && (!Array.isArray(requestedCapabilities) || requestedCapabilities.some((capability) => !allowedCapabilities.has(capability?.value || capability)))) {
      throw new Error("Pinterest capability is not authorized");
    }
    return Object.freeze({ ...request, credentialId, businessPackageId });
  }

  return Object.freeze({ businessPackageId, credentialId, resolve });
}

module.exports = { DEFAULT_BUSINESS_PACKAGE_ID, createPinterestContextResolver };