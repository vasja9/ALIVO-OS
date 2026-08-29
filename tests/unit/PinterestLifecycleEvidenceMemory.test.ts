import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_WINDOWS_PER_PIN,
  PinterestLifecycleEvidenceMemoryError,
  createPinterestLifecycleEvidenceMemory,
} = require("../../electron/pinterest-lifecycle-evidence-memory.cjs");

const PIN = "private-pin-1";
const CREATED_AT = "2026-06-24T00:00:00.000Z";

function fakeSafeStorage({ available = true, decryptFailure = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(value, "utf8").map((byte) => byte ^ 0xa5),
    decryptString: (value: Buffer) => {
      if (decryptFailure) throw new Error("decrypt failure");
      return Buffer.from(value).map((byte) => byte ^ 0xa5).toString("utf8");
    },
  };
}

async function fixture(options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alivo-pinterest-evidence-"));
  const filePath = path.join(directory, "state", "pinterest-lifecycle-evidence.enc");
  return { directory, filePath, memory: createPinterestLifecycleEvidenceMemory({ filePath, safeStorage: fakeSafeStorage(), ...options }) };
}

function observation(windowStartDate: string, windowEndDate: string, outboundClicks = 0, pinReference = PIN, createdAt = CREATED_AT) {
  return { pinReference, createdAt, windowStartDate, windowEndDate, outboundClicks, observedAt: `${new Date(Date.parse(`${windowEndDate}T00:00:00.000Z`) + 86_400_000).toISOString()}`, coverage: "CompletePinWindow" };
}

test("complete zero-click history reaches deterministic 60-day variant-brief eligibility", async () => {
  const value = await fixture();
  try {
    const first = await value.memory.record(observation("2026-06-24", "2026-07-23"));
    assert.equal(first.completedAgeDays, 30);
    assert.equal(first.variantEligibility, "NotEligible");
    const second = await value.memory.record(observation("2026-07-24", "2026-08-22"));
    assert.deepEqual(second, {
      createdAt: CREATED_AT,
      completedAgeDays: 60,
      observedWindowCount: 2,
      firstObservedDate: "2026-06-24",
      lastObservedDate: "2026-08-22",
      totalOutboundClicks: 0,
      continuity: "CompleteSincePublication",
      variantEligibility: "EligibleForBrief",
    });
    assert.equal(Object.isFrozen(second), true);
    assert.deepEqual(await value.memory.status(), { ok: true, encryptionAvailable: true, pinCount: 1, observationCount: 2 });
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("positive clicks are conclusive while incomplete, gapped, and stale zero-click histories remain unknown", async () => {
  const incomplete = await fixture();
  const gapped = await fixture();
  const clicked = await fixture();
  const stale = await fixture();
  try {
    assert.equal((await incomplete.memory.record(observation("2026-07-24", "2026-08-22"))).continuity, "IncompleteBeforeFirstRetainedWindow");
    assert.equal((await incomplete.memory.summarize(PIN, "2026-08-22")).variantEligibility, "Unknown");
    await gapped.memory.record(observation("2026-06-24", "2026-07-23"));
    await gapped.memory.record(observation("2026-07-25", "2026-08-23"));
    assert.equal((await gapped.memory.summarize(PIN, "2026-08-23")).continuity, "GapDetected");
    assert.equal((await gapped.memory.summarize(PIN, "2026-08-23")).variantEligibility, "Unknown");
    assert.equal((await gapped.memory.summarize(PIN, "2026-08-24")).continuity, "GapDetected");
    await clicked.memory.record(observation("2026-07-24", "2026-08-22", 1));
    assert.equal((await clicked.memory.summarize(PIN, "2026-08-22")).variantEligibility, "NotEligible");
    await stale.memory.record(observation("2026-06-24", "2026-07-23"));
    await stale.memory.record(observation("2026-07-24", "2026-08-22"));
    assert.equal((await stale.memory.summarize(PIN, "2026-08-23")).continuity, "Stale");
    assert.equal((await stale.memory.summarize(PIN, "2026-08-23")).variantEligibility, "Unknown");
  } finally {
    await Promise.all([incomplete, gapped, clicked, stale].map((value) => rm(value.directory, { recursive: true, force: true })));
  }
});

test("identical windows deduplicate and conflicting or overlapping evidence fails closed", async () => {
  const value = await fixture();
  try {
    await value.memory.record(observation("2026-06-24", "2026-07-23"));
    await value.memory.record({ ...observation("2026-06-24", "2026-07-23"), observedAt: "2026-07-25T00:00:00.000Z" });
    assert.equal((await value.memory.status()).observationCount, 1);
    await assert.rejects(value.memory.record(observation("2026-06-24", "2026-07-23", 1)), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "EVIDENCE_CONFLICT");
    await assert.rejects(value.memory.record(observation("2026-07-20", "2026-08-18")), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "EVIDENCE_OVERLAP");
    await assert.rejects(value.memory.record({ ...observation("2026-07-24", "2026-08-22"), createdAt: "2026-06-25T00:00:00.000Z" }), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "EVIDENCE_CONFLICT");
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("only explicit complete 30-day per-Pin observations are accepted", async () => {
  const value = await fixture();
  try {
    for (const input of [
      { ...observation("2026-07-24", "2026-08-22"), coverage: "TopPins25" },
      observation("2026-07-24", "2026-08-21"),
      { ...observation("2026-07-24", "2026-08-22"), outboundClicks: -1 },
      { ...observation("2026-07-24", "2026-08-22"), observedAt: "2026-08-22T12:00:00.000Z" },
      { ...observation("2026-07-24", "2026-08-22"), createdAt: "2026-08-23T00:00:00.000Z" },
    ]) await assert.rejects(value.memory.record(input), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "EVIDENCE_INVALID");
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("evidence is encrypted at rest, renderer-safe summaries omit Pin references, and retention is bounded", async () => {
  const value = await fixture();
  try {
    for (let index = 0; index <= MAX_WINDOWS_PER_PIN; index += 1) {
      const start = new Date(Date.parse("2025-01-01T00:00:00.000Z") + index * 30 * 86_400_000);
      const end = new Date(start.getTime() + 29 * 86_400_000);
      await value.memory.record(observation(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 0, PIN, "2025-01-01T00:00:00.000Z"));
    }
    const status = await value.memory.status();
    assert.equal(status.observationCount, MAX_WINDOWS_PER_PIN);
    const summary = await value.memory.summarize(PIN, "2026-09-22");
    assert.equal(summary.continuity, "IncompleteBeforeFirstRetainedWindow");
    assert.equal(summary.variantEligibility, "Unknown");
    assert.equal(JSON.stringify(summary).includes(PIN), false);
    assert.equal(JSON.stringify(status).includes(PIN), false);
    assert.equal((await readFile(value.filePath, "utf8")).includes(PIN), false);
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("unavailable encryption and corrupt ciphertext fail closed without releasing evidence", async () => {
  const unavailable = await fixture({ safeStorage: fakeSafeStorage({ available: false }) });
  const corrupt = await fixture({ safeStorage: fakeSafeStorage({ decryptFailure: true }) });
  try {
    assert.deepEqual(await unavailable.memory.status(), { ok: false, encryptionAvailable: false, pinCount: 0, observationCount: 0, code: "ENCRYPTION_UNAVAILABLE" });
    await assert.rejects(unavailable.memory.record(observation("2026-07-24", "2026-08-22")), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "ENCRYPTION_UNAVAILABLE");
    await mkdir(path.dirname(corrupt.filePath), { recursive: true });
    await writeFile(corrupt.filePath, JSON.stringify({ version: 1, provider: "electron-safeStorage", ciphertext: "corrupt" }));
    assert.deepEqual(await corrupt.memory.status(), { ok: false, encryptionAvailable: true, pinCount: 0, observationCount: 0, code: "EVIDENCE_MEMORY_CORRUPT" });
    await assert.rejects(corrupt.memory.summarize(PIN, "2026-08-22"), (error: unknown) => error instanceof PinterestLifecycleEvidenceMemoryError && error.code === "EVIDENCE_MEMORY_CORRUPT");
  } finally {
    await Promise.all([unavailable, corrupt].map((value) => rm(value.directory, { recursive: true, force: true })));
  }
});

test("evidence memory has no Pinterest transport, renderer persistence, or mutation surface", async () => {
  const source = await readFile("electron/pinterest-lifecycle-evidence-memory.cjs", "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon|pins:write|\.publish\(|\.delete\(|\.edit\(/i);
  assert.match(source, /createSafeStorageAdapter/);
  assert.match(source, /CompletePinWindow/);
  assert.doesNotMatch(source, /return Object\.freeze\(\{[^}]*pinReference/s);
});
