"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createSafeStorageAdapter } = require("./pinterest-local-vault.cjs");

const MEMORY_VERSION = 1;
const MEMORY_FILE_NAME = "pinterest-pin-families.enc";
const MAX_PIN_FAMILIES = 1_000;
const MAX_FAMILY_MEMBERS = 4;
const PIN_FAMILY_COHORTS = Object.freeze([
  "Days60To90",
  "Days91To180",
  "Days181To600",
]);

class PinterestPinFamilyMemoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PinterestPinFamilyMemoryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PinterestPinFamilyMemoryError(code, message);
}

function safeFamilyReference(value) {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    fail("FAMILY_INVALID", "Pinterest Pin family reference is invalid");
  }
  return value;
}

function safePinReference(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    fail("FAMILY_INVALID", "Pinterest Pin reference is invalid");
  }
  return value;
}

function exactUtcInstant(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail("FAMILY_INVALID", `${name} must be an exact UTC instant`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("FAMILY_INVALID", `${name} must be an exact UTC instant`);
  }
  return value;
}

function exactCohort(value) {
  if (!PIN_FAMILY_COHORTS.includes(value)) fail("FAMILY_INVALID", "Pinterest Pin family cohort is invalid");
  return value;
}

function expectedBriefReference(familyReference, cohort) {
  return `lifecycle-variant:${familyReference}:${cohort}`;
}

function normalizeOriginal(value) {
  return {
    pinReference: safePinReference(value?.pinReference),
    publishedAt: exactUtcInstant(value?.publishedAt, "Original Pin publication time"),
  };
}

function normalizeVariant(value, familyReference, originalPublishedAt) {
  const cohort = exactCohort(value?.cohort);
  const briefReference = value?.briefReference;
  if (briefReference !== expectedBriefReference(familyReference, cohort)) {
    fail("FAMILY_INVALID", "Pinterest lifecycle variant brief reference is invalid");
  }
  const publishedAt = exactUtcInstant(value?.publishedAt, "Variant Pin publication time");
  if (publishedAt < originalPublishedAt) fail("FAMILY_INVALID", "Variant Pin cannot predate the original Pin");
  return {
    pinReference: safePinReference(value?.pinReference),
    cohort,
    briefReference,
    publishedAt,
  };
}

function normalizeFamily(value) {
  const familyReference = safeFamilyReference(value?.familyReference);
  const original = normalizeOriginal(value?.original);
  if (!Array.isArray(value?.variants) || value.variants.length >= MAX_FAMILY_MEMBERS) {
    fail("FAMILY_INVALID", "Pinterest Pin family variant count is invalid");
  }
  const variants = value.variants.map((variant) => normalizeVariant(variant, familyReference, original.publishedAt));
  for (let index = 1; index < variants.length; index += 1) {
    const previousRank = PIN_FAMILY_COHORTS.indexOf(variants[index - 1].cohort);
    const currentRank = PIN_FAMILY_COHORTS.indexOf(variants[index].cohort);
    if (currentRank <= previousRank) fail("FAMILY_INVALID", "Pinterest Pin family cohorts are not chronological");
  }
  if (new Set(variants.map((variant) => variant.cohort)).size !== variants.length) {
    fail("FAMILY_INVALID", "Pinterest Pin family contains duplicate cohorts");
  }
  return { familyReference, original, variants };
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== MEMORY_VERSION || !Array.isArray(value.families) || value.families.length > MAX_PIN_FAMILIES) {
    fail("FAMILY_INVALID", "Pinterest Pin family memory document is invalid");
  }
  const families = value.families.map(normalizeFamily);
  if (new Set(families.map((family) => family.familyReference)).size !== families.length) {
    fail("FAMILY_INVALID", "Pinterest Pin family memory contains duplicate families");
  }
  const pinReferences = families.flatMap((family) => [family.original.pinReference, ...family.variants.map((variant) => variant.pinReference)]);
  if (new Set(pinReferences).size !== pinReferences.length) {
    fail("FAMILY_INVALID", "Pinterest Pin family memory assigns a Pin more than once");
  }
  return { version: MEMORY_VERSION, families };
}

function familySummary(family) {
  return Object.freeze({
    familyReference: family.familyReference,
    memberCount: family.variants.length + 1,
    usedCohorts: Object.freeze(family.variants.map((variant) => variant.cohort)),
  });
}

function sameOriginal(left, right) {
  return left.pinReference === right.pinReference && left.publishedAt === right.publishedAt;
}

function sameVariant(left, right) {
  return left.pinReference === right.pinReference
    && left.cohort === right.cohort
    && left.briefReference === right.briefReference
    && left.publishedAt === right.publishedAt;
}

function assignedFamily(document, pinReference) {
  return document.families.find((family) => family.original.pinReference === pinReference
    || family.variants.some((variant) => variant.pinReference === pinReference));
}

function createPinterestPinFamilyMemory({ filePath, safeStorage, fileSystem = fs } = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") fail("FAMILY_INVALID", "Pinterest Pin family memory path is required");
  let storage;
  try {
    storage = createSafeStorageAdapter(safeStorage);
  } catch {
    fail("ENCRYPTION_UNAVAILABLE", "Pinterest Pin family encryption is unavailable");
  }
  let writeTail = Promise.resolve();

  async function readDocument() {
    if (!storage.isEncryptionAvailable()) fail("ENCRYPTION_UNAVAILABLE", "Pinterest Pin family encryption is unavailable");
    try {
      const envelope = JSON.parse(await fileSystem.readFile(filePath, "utf8"));
      if (envelope?.version !== MEMORY_VERSION || envelope.provider !== "electron-safeStorage" || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length < 1) {
        throw new Error("Invalid Pinterest Pin family envelope");
      }
      const plaintext = storage.decrypt(Buffer.from(envelope.ciphertext, "base64url"));
      return normalizeDocument(JSON.parse(plaintext));
    } catch (error) {
      if (error?.code === "ENOENT") return { version: MEMORY_VERSION, families: [] };
      if (error instanceof PinterestPinFamilyMemoryError && error.code === "ENCRYPTION_UNAVAILABLE") throw error;
      throw new PinterestPinFamilyMemoryError("FAMILY_MEMORY_CORRUPT", "Pinterest Pin family memory could not be opened");
    }
  }

  async function writeDocument(value) {
    let ciphertext;
    try {
      ciphertext = storage.encrypt(JSON.stringify(value));
    } catch {
      fail("ENCRYPTION_FAILURE", "Pinterest Pin family memory could not be encrypted");
    }
    const envelope = JSON.stringify({
      version: MEMORY_VERSION,
      provider: "electron-safeStorage",
      ciphertext: Buffer.from(ciphertext).toString("base64url"),
    });
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await fileSystem.writeFile(temporary, envelope, { encoding: "utf8", mode: 0o600 });
    await fileSystem.rename(temporary, filePath);
    try { await fileSystem.chmod(filePath, 0o600); } catch { /* DPAPI remains the Windows user boundary. */ }
  }

  function serialize(operation) {
    const pending = writeTail.then(operation, operation);
    writeTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function registerOriginal(input) {
    return serialize(async () => {
      const familyReference = safeFamilyReference(input?.familyReference);
      const original = normalizeOriginal(input);
      const document = await readDocument();
      const family = document.families.find((value) => value.familyReference === familyReference);
      if (family) {
        if (!sameOriginal(family.original, original)) fail("FAMILY_CONFLICT", "Pinterest Pin family original conflicts with the stored record");
        return familySummary(family);
      }
      if (assignedFamily(document, original.pinReference)) fail("PIN_ALREADY_ASSIGNED", "Pinterest Pin is already assigned to another family");
      if (document.families.length >= MAX_PIN_FAMILIES) fail("FAMILY_LIMIT_REACHED", "Pinterest Pin family memory is full");
      const created = { familyReference, original, variants: [] };
      document.families.push(created);
      await writeDocument(document);
      return familySummary(created);
    });
  }

  async function recordPublishedVariant(input) {
    return serialize(async () => {
      const familyReference = safeFamilyReference(input?.familyReference);
      const document = await readDocument();
      const family = document.families.find((value) => value.familyReference === familyReference);
      if (!family) fail("FAMILY_NOT_FOUND", "Pinterest Pin family is not registered");
      const variant = normalizeVariant(input, familyReference, family.original.publishedAt);
      const existingCohort = family.variants.find((value) => value.cohort === variant.cohort);
      if (existingCohort) {
        if (!sameVariant(existingCohort, variant)) fail("FAMILY_CONFLICT", "Pinterest Pin family cohort conflicts with the stored variant");
        return familySummary(family);
      }
      if (family.variants.length + 1 >= MAX_FAMILY_MEMBERS) fail("FAMILY_LIMIT_REACHED", "Pinterest Pin family already contains the maximum four members");
      if (assignedFamily(document, variant.pinReference)) fail("PIN_ALREADY_ASSIGNED", "Pinterest Pin is already assigned to a family");
      const lastCohort = family.variants.at(-1)?.cohort;
      if (lastCohort && PIN_FAMILY_COHORTS.indexOf(variant.cohort) <= PIN_FAMILY_COHORTS.indexOf(lastCohort)) {
        fail("COHORT_ALREADY_USED", "Pinterest Pin family cohort history must move forward");
      }
      family.variants.push(variant);
      await writeDocument(document);
      return familySummary(family);
    });
  }

  async function summarize(familyReferenceValue) {
    const familyReference = safeFamilyReference(familyReferenceValue);
    const document = await readDocument();
    const family = document.families.find((value) => value.familyReference === familyReference);
    return family ? familySummary(family) : null;
  }

  async function status() {
    if (!storage.isEncryptionAvailable()) {
      return Object.freeze({ ok: false, encryptionAvailable: false, familyCount: 0, memberCount: 0, code: "ENCRYPTION_UNAVAILABLE" });
    }
    try {
      const document = await readDocument();
      return Object.freeze({
        ok: true,
        encryptionAvailable: true,
        familyCount: document.families.length,
        memberCount: document.families.reduce((total, family) => total + family.variants.length + 1, 0),
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        encryptionAvailable: true,
        familyCount: 0,
        memberCount: 0,
        code: error?.code === "FAMILY_MEMORY_CORRUPT" ? error.code : "FAMILY_MEMORY_UNAVAILABLE",
      });
    }
  }

  return Object.freeze({ registerOriginal, recordPublishedVariant, summarize, status, filePath });
}

function defaultPinterestPinFamilyMemoryPath(userDataPath) {
  return path.join(userDataPath, "state", MEMORY_FILE_NAME);
}

module.exports = {
  MAX_FAMILY_MEMBERS,
  MAX_PIN_FAMILIES,
  MEMORY_FILE_NAME,
  MEMORY_VERSION,
  PIN_FAMILY_COHORTS,
  PinterestPinFamilyMemoryError,
  createPinterestPinFamilyMemory,
  defaultPinterestPinFamilyMemoryPath,
};
