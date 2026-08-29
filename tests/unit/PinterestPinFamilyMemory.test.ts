import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_FAMILY_MEMBERS,
  PinterestPinFamilyMemoryError,
  createPinterestPinFamilyMemory,
  defaultPinterestPinFamilyMemoryPath,
} = require("../../electron/pinterest-pin-family-memory.cjs");

const FAMILY = "family:thyroid-health";
const ORIGINAL = "private_pin_original";
const ORIGINAL_PUBLISHED_AT = "2026-01-01T08:00:00.000Z";

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
  const directory = await mkdtemp(path.join(os.tmpdir(), "alivo-pinterest-pin-family-"));
  const filePath = defaultPinterestPinFamilyMemoryPath(directory);
  return { directory, filePath, memory: createPinterestPinFamilyMemory({ filePath, safeStorage: fakeSafeStorage(), ...options }) };
}

function original(familyReference = FAMILY, pinReference = ORIGINAL, publishedAt = ORIGINAL_PUBLISHED_AT) {
  return { familyReference, pinReference, publishedAt };
}

function variant(cohort: string, ordinal: number, familyReference = FAMILY, pinReference = `private_pin_variant_${ordinal}`) {
  return {
    familyReference,
    pinReference,
    cohort,
    briefReference: `lifecycle-variant:${familyReference}:${cohort}`,
    publishedAt: `2026-0${ordinal + 2}-01T08:00:00.000Z`,
  };
}

test("encrypted family lineage produces immutable test.3.37-compatible summaries", async () => {
  const value = await fixture();
  try {
    assert.deepEqual(await value.memory.registerOriginal(original()), {
      familyReference: FAMILY,
      memberCount: 1,
      usedCohorts: [],
    });
    await value.memory.recordPublishedVariant(variant("Days60To90", 1));
    await value.memory.recordPublishedVariant(variant("Days91To180", 2));
    const summary = await value.memory.recordPublishedVariant(variant("Days181To600", 3));
    assert.deepEqual(summary, {
      familyReference: FAMILY,
      memberCount: MAX_FAMILY_MEMBERS,
      usedCohorts: ["Days60To90", "Days91To180", "Days181To600"],
    });
    assert.equal(Object.isFrozen(summary), true);
    assert.equal(Object.isFrozen(summary.usedCohorts), true);
    assert.deepEqual(await value.memory.summarize(FAMILY), summary);
    assert.deepEqual(await value.memory.status(), { ok: true, encryptionAvailable: true, familyCount: 1, memberCount: 4 });
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("exact replays are idempotent while conflicting lineage fails closed", async () => {
  const value = await fixture();
  try {
    await value.memory.registerOriginal(original());
    await value.memory.registerOriginal(original());
    await value.memory.recordPublishedVariant(variant("Days60To90", 1));
    await value.memory.recordPublishedVariant(variant("Days60To90", 1));
    assert.deepEqual(await value.memory.status(), { ok: true, encryptionAvailable: true, familyCount: 1, memberCount: 2 });
    await assert.rejects(
      value.memory.registerOriginal(original(FAMILY, "different_original")),
      (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_CONFLICT",
    );
    await assert.rejects(
      value.memory.recordPublishedVariant(variant("Days60To90", 1, FAMILY, "different_variant")),
      (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_CONFLICT",
    );
    await assert.rejects(
      value.memory.registerOriginal(original("family:other", "private_pin_variant_1")),
      (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "PIN_ALREADY_ASSIGNED",
    );
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("families require an original, move only forward through cohorts, and stop at four members", async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      value.memory.recordPublishedVariant(variant("Days60To90", 1)),
      (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_NOT_FOUND",
    );
    await value.memory.registerOriginal(original());
    await value.memory.recordPublishedVariant(variant("Days91To180", 2));
    await assert.rejects(
      value.memory.recordPublishedVariant(variant("Days60To90", 1)),
      (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "COHORT_ALREADY_USED",
    );
    await value.memory.recordPublishedVariant(variant("Days181To600", 3));
    assert.equal((await value.memory.summarize(FAMILY)).memberCount, 3);

    const full = await fixture();
    try {
      await full.memory.registerOriginal(original());
      await full.memory.recordPublishedVariant(variant("Days60To90", 1));
      await full.memory.recordPublishedVariant(variant("Days91To180", 2));
      await full.memory.recordPublishedVariant(variant("Days181To600", 3));
      await assert.rejects(
        full.memory.recordPublishedVariant({ ...variant("Days181To600", 4), briefReference: `lifecycle-variant:${FAMILY}:Days181To600` }),
        (error: unknown) => error instanceof PinterestPinFamilyMemoryError && (error.code === "FAMILY_CONFLICT" || error.code === "FAMILY_LIMIT_REACHED"),
      );
    } finally { await rm(full.directory, { recursive: true, force: true }); }
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("invalid references, timestamps, cohorts, and unrelated brief references are rejected", async () => {
  const value = await fixture();
  try {
    for (const input of [
      original("family with spaces"),
      original(FAMILY, "provider:pin"),
      original(FAMILY, ORIGINAL, "2026-01-01"),
    ]) {
      await assert.rejects(value.memory.registerOriginal(input), (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_INVALID");
    }
    await value.memory.registerOriginal(original());
    for (const input of [
      variant("Unknown", 1),
      { ...variant("Days60To90", 1), briefReference: "brief:unrelated" },
      { ...variant("Days60To90", 1), publishedAt: "2025-12-31T08:00:00.000Z" },
      { ...variant("Days60To90", 1), pinReference: "provider:pin" },
    ]) {
      await assert.rejects(value.memory.recordPublishedVariant(input), (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_INVALID");
    }
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("Pin and brief references remain encrypted at rest and absent from safe status output", async () => {
  const value = await fixture();
  try {
    await Promise.all([
      value.memory.registerOriginal(original()),
      value.memory.registerOriginal(original()),
    ]);
    await Promise.all([
      value.memory.recordPublishedVariant(variant("Days60To90", 1)),
      value.memory.recordPublishedVariant(variant("Days60To90", 1)),
    ]);
    const stored = await readFile(value.filePath, "utf8");
    const status = await value.memory.status();
    const summary = await value.memory.summarize(FAMILY);
    assert.equal(stored.includes(ORIGINAL), false);
    assert.equal(stored.includes("private_pin_variant_1"), false);
    assert.equal(stored.includes("lifecycle-variant"), false);
    assert.equal(JSON.stringify(status).includes("pinReference"), false);
    assert.equal(JSON.stringify(status).includes("briefReference"), false);
    assert.equal(JSON.stringify(summary).includes(ORIGINAL), false);
  } finally { await rm(value.directory, { recursive: true, force: true }); }
});

test("unavailable encryption and corrupt ciphertext fail closed", async () => {
  const unavailable = await fixture({ safeStorage: fakeSafeStorage({ available: false }) });
  const corrupt = await fixture({ safeStorage: fakeSafeStorage({ decryptFailure: true }) });
  try {
    assert.deepEqual(await unavailable.memory.status(), { ok: false, encryptionAvailable: false, familyCount: 0, memberCount: 0, code: "ENCRYPTION_UNAVAILABLE" });
    await assert.rejects(unavailable.memory.registerOriginal(original()), (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "ENCRYPTION_UNAVAILABLE");
    await mkdir(path.dirname(corrupt.filePath), { recursive: true });
    await writeFile(corrupt.filePath, JSON.stringify({ version: 1, provider: "electron-safeStorage", ciphertext: "corrupt" }));
    assert.deepEqual(await corrupt.memory.status(), { ok: false, encryptionAvailable: true, familyCount: 0, memberCount: 0, code: "FAMILY_MEMORY_CORRUPT" });
    await assert.rejects(corrupt.memory.summarize(FAMILY), (error: unknown) => error instanceof PinterestPinFamilyMemoryError && error.code === "FAMILY_MEMORY_CORRUPT");
  } finally {
    await Promise.all([unavailable, corrupt].map((entry) => rm(entry.directory, { recursive: true, force: true })));
  }
});

test("family memory has no Pinterest transport, renderer persistence, or destructive mutation surface", async () => {
  const source = await readFile("electron/pinterest-pin-family-memory.cjs", "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon|pins:write|\.publish\(|\.delete\(|\.edit\(/i);
  assert.match(source, /createSafeStorageAdapter/);
  assert.match(source, /writeFile\(temporary/);
  assert.match(source, /rename\(temporary/);
  assert.doesNotMatch(source, /return Object\.freeze\(\{[^}]*pinReference/s);
});
