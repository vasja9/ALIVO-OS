"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createSafeStorageAdapter } = require("./pinterest-local-vault.cjs");

const UTC_DAY_MS = 86_400_000;
const MEMORY_VERSION = 1;
const MEMORY_FILE_NAME = "pinterest-lifecycle-evidence.enc";
const MAX_PIN_RECORDS = 1_000;
const MAX_WINDOWS_PER_PIN = 20;
const COMPLETE_WINDOW_DAYS = 30;

class PinterestLifecycleEvidenceMemoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PinterestLifecycleEvidenceMemoryError";
    this.code = code;
  }
}

function invalid(message) {
  throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_INVALID", message);
}

function exactUtcInstant(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid(`${name} must be an exact UTC instant`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(`${name} must be an exact UTC instant`);
  return value;
}

function exactUtcDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${name} must be an exact UTC date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${name} must be an exact UTC date`);
  return value;
}

function dateMs(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function nextDate(value) {
  return new Date(dateMs(value) + UTC_DAY_MS).toISOString().slice(0, 10);
}

function pinReference(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) invalid("Pinterest Pin reference is invalid");
  return value;
}

function safeClicks(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid("Outbound clicks must be a non-negative safe integer");
  return value;
}

function normalizeObservation(input, createdAt) {
  if (input?.coverage !== "CompletePinWindow") invalid("Only complete per-Pin windows may enter evidence memory");
  const windowStartDate = exactUtcDate(input.windowStartDate, "Window start");
  const windowEndDate = exactUtcDate(input.windowEndDate, "Window end");
  if ((dateMs(windowEndDate) - dateMs(windowStartDate)) / UTC_DAY_MS + 1 !== COMPLETE_WINDOW_DAYS) {
    invalid("Pinterest evidence windows must contain exactly 30 completed UTC days");
  }
  if (windowEndDate < createdAt.slice(0, 10)) invalid("Evidence window must reach the Pin publication date");
  const observedAt = exactUtcInstant(input.observedAt, "Observed at");
  if (Date.parse(observedAt) < dateMs(windowEndDate) + UTC_DAY_MS) invalid("Evidence may be recorded only after the window is complete");
  return Object.freeze({
    windowStartDate,
    windowEndDate,
    outboundClicks: safeClicks(input.outboundClicks),
    observedAt,
    coverage: "CompletePinWindow",
  });
}

function normalizeObservations(values, createdAt) {
  if (!Array.isArray(values) || values.length > MAX_WINDOWS_PER_PIN) invalid("Pinterest evidence window count is invalid");
  const sorted = values.map((value) => normalizeObservation(value, createdAt))
    .sort((left, right) => left.windowStartDate.localeCompare(right.windowStartDate));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].windowStartDate <= sorted[index - 1].windowEndDate) invalid("Pinterest evidence windows must not overlap");
  }
  return sorted;
}

function normalizeRecord(value) {
  const reference = pinReference(value?.pinReference);
  const createdAt = exactUtcInstant(value?.createdAt, "Pin publication time");
  const observations = normalizeObservations(value?.observations, createdAt);
  sumClicks(observations);
  return { pinReference: reference, createdAt, observations };
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== MEMORY_VERSION || !Array.isArray(value.records) || value.records.length > MAX_PIN_RECORDS) {
    invalid("Pinterest evidence memory document is invalid");
  }
  const records = value.records.map(normalizeRecord);
  if (new Set(records.map((record) => record.pinReference)).size !== records.length) invalid("Pinterest evidence memory contains duplicate Pin records");
  return { version: MEMORY_VERSION, records };
}

function completedAgeDays(createdAt, asOfDate) {
  const endExclusive = dateMs(asOfDate) + UTC_DAY_MS;
  const createdAtMs = Date.parse(createdAt);
  if (createdAtMs >= endExclusive) return null;
  const value = Math.floor((endExclusive - createdAtMs) / UTC_DAY_MS);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sumClicks(observations) {
  let total = 0;
  for (const observation of observations) {
    total += observation.outboundClicks;
    if (!Number.isSafeInteger(total)) invalid("Stored outbound-click evidence exceeds the safe integer range");
  }
  return total;
}

function summaryFor(record, asOfDate) {
  const ageDays = completedAgeDays(record.createdAt, asOfDate);
  const observations = record.observations.filter((value) => value.windowEndDate <= asOfDate);
  const totalOutboundClicks = sumClicks(observations);
  let continuity = "NoEvidence";
  if (observations.length > 0) {
    const hasGap = observations.some((value, index) => index > 0 && value.windowStartDate !== nextDate(observations[index - 1].windowEndDate));
    if (hasGap) continuity = "GapDetected";
    else if (observations[0].windowStartDate > record.createdAt.slice(0, 10)) continuity = "IncompleteBeforeFirstRetainedWindow";
    else if (observations.at(-1).windowEndDate !== asOfDate) continuity = "Stale";
    else continuity = "CompleteSincePublication";
  }
  let variantEligibility = "Unknown";
  if (totalOutboundClicks > 0 || (ageDays !== null && ageDays < 60)) variantEligibility = "NotEligible";
  else if (continuity === "CompleteSincePublication" && ageDays !== null && ageDays >= 60) variantEligibility = "EligibleForBrief";
  return Object.freeze({
    createdAt: record.createdAt,
    completedAgeDays: ageDays,
    observedWindowCount: observations.length,
    firstObservedDate: observations[0]?.windowStartDate ?? null,
    lastObservedDate: observations.at(-1)?.windowEndDate ?? null,
    totalOutboundClicks,
    continuity,
    variantEligibility,
  });
}

function emptySummary() {
  return Object.freeze({
    createdAt: null,
    completedAgeDays: null,
    observedWindowCount: 0,
    firstObservedDate: null,
    lastObservedDate: null,
    totalOutboundClicks: 0,
    continuity: "NoEvidence",
    variantEligibility: "Unknown",
  });
}

function createPinterestLifecycleEvidenceMemory({ filePath, safeStorage, fileSystem = fs } = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") invalid("Pinterest evidence memory path is required");
  const storage = createSafeStorageAdapter(safeStorage);
  let writeTail = Promise.resolve();

  async function readDocument() {
    if (!storage.isEncryptionAvailable()) throw new PinterestLifecycleEvidenceMemoryError("ENCRYPTION_UNAVAILABLE", "Pinterest evidence encryption is unavailable");
    try {
      const envelope = JSON.parse(await fileSystem.readFile(filePath, "utf8"));
      if (envelope?.version !== MEMORY_VERSION || envelope.provider !== "electron-safeStorage" || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length < 1) {
        throw new Error("Invalid Pinterest evidence envelope");
      }
      const plaintext = storage.decrypt(Buffer.from(envelope.ciphertext, "base64url"));
      return normalizeDocument(JSON.parse(plaintext));
    } catch (error) {
      if (error?.code === "ENOENT") return { version: MEMORY_VERSION, records: [] };
      if (error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "ENCRYPTION_UNAVAILABLE") throw error;
      throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_MEMORY_CORRUPT", "Pinterest lifecycle evidence memory could not be opened");
    }
  }

  async function writeDocument(value) {
    let ciphertext;
    try {
      ciphertext = storage.encrypt(JSON.stringify(value));
    } catch {
      throw new PinterestLifecycleEvidenceMemoryError("ENCRYPTION_FAILURE", "Pinterest lifecycle evidence memory could not be encrypted");
    }
    const envelope = JSON.stringify({ version: MEMORY_VERSION, provider: "electron-safeStorage", ciphertext: Buffer.from(ciphertext).toString("base64url") });
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await fileSystem.writeFile(temporary, envelope, { encoding: "utf8", mode: 0o600 });
    await fileSystem.rename(temporary, filePath);
    try { await fileSystem.chmod(filePath, 0o600); } catch { /* DPAPI is the Windows user boundary. */ }
  }

  function serialize(operation) {
    const pending = writeTail.then(operation, operation);
    writeTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function record(input) {
    return serialize(async () => {
      const reference = pinReference(input?.pinReference);
      const createdAt = exactUtcInstant(input?.createdAt, "Pin publication time");
      const observation = normalizeObservation(input, createdAt);
      const document = await readDocument();
      let recordValue = document.records.find((value) => value.pinReference === reference);
      if (!recordValue) {
        if (document.records.length >= MAX_PIN_RECORDS) throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_CAPACITY_REACHED", "Pinterest evidence memory is full");
        recordValue = { pinReference: reference, createdAt, observations: [] };
        document.records.push(recordValue);
      } else if (recordValue.createdAt !== createdAt) {
        throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_CONFLICT", "Pinterest Pin publication evidence conflicts with the stored record");
      }
      const sameWindow = recordValue.observations.find((value) => value.windowStartDate === observation.windowStartDate && value.windowEndDate === observation.windowEndDate);
      if (sameWindow) {
        if (sameWindow.outboundClicks !== observation.outboundClicks) throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_CONFLICT", "Pinterest click evidence conflicts with the stored window");
        return summaryFor(recordValue, observation.windowEndDate);
      }
      if (recordValue.observations.some((value) => observation.windowStartDate <= value.windowEndDate && observation.windowEndDate >= value.windowStartDate)) {
        throw new PinterestLifecycleEvidenceMemoryError("EVIDENCE_OVERLAP", "Pinterest evidence windows overlap");
      }
      recordValue.observations.push(observation);
      recordValue.observations.sort((left, right) => left.windowStartDate.localeCompare(right.windowStartDate));
      if (recordValue.observations.length > MAX_WINDOWS_PER_PIN) recordValue.observations.splice(0, recordValue.observations.length - MAX_WINDOWS_PER_PIN);
      sumClicks(recordValue.observations);
      await writeDocument(document);
      return summaryFor(recordValue, observation.windowEndDate);
    });
  }

  async function summarize(referenceValue, asOfDateValue) {
    const reference = pinReference(referenceValue);
    const asOfDate = exactUtcDate(asOfDateValue, "Evidence as-of date");
    const document = await readDocument();
    const recordValue = document.records.find((value) => value.pinReference === reference);
    return recordValue ? summaryFor(recordValue, asOfDate) : emptySummary();
  }

  async function status() {
    if (!storage.isEncryptionAvailable()) return Object.freeze({ ok: false, encryptionAvailable: false, pinCount: 0, observationCount: 0, code: "ENCRYPTION_UNAVAILABLE" });
    try {
      const document = await readDocument();
      return Object.freeze({
        ok: true,
        encryptionAvailable: true,
        pinCount: document.records.length,
        observationCount: document.records.reduce((total, value) => total + value.observations.length, 0),
      });
    } catch (error) {
      return Object.freeze({ ok: false, encryptionAvailable: true, pinCount: 0, observationCount: 0, code: error?.code === "EVIDENCE_MEMORY_CORRUPT" ? error.code : "EVIDENCE_MEMORY_UNAVAILABLE" });
    }
  }

  return Object.freeze({ record, summarize, status, filePath });
}

function defaultPinterestLifecycleEvidenceMemoryPath(userDataPath) {
  return path.join(userDataPath, "state", MEMORY_FILE_NAME);
}

module.exports = {
  COMPLETE_WINDOW_DAYS,
  MAX_PIN_RECORDS,
  MAX_WINDOWS_PER_PIN,
  MEMORY_FILE_NAME,
  MEMORY_VERSION,
  PinterestLifecycleEvidenceMemoryError,
  createPinterestLifecycleEvidenceMemory,
  defaultPinterestLifecycleEvidenceMemoryPath,
};
