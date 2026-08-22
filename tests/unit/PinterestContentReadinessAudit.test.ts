import assert from "node:assert/strict";
import test from "node:test";
import { auditPinterestContent, PINTEREST_CONTENT_AUDIT_CODES } from "../../src/integrations/pinterest/PinterestContentReadinessAudit.ts";

const ready = (overrides: Record<string, unknown> = {}) => ({
  pinId: "pin-1",
  title: "ALIVO guide",
  description: "A useful description",
  createdAt: "2026-08-22T12:00:00.000Z",
  boardName: "ALIVO",
  destinationDomain: "alivo.eu",
  thumbnailPresent: true,
  ...overrides,
});
const codes = (pin: Record<string, unknown>) => auditPinterestContent([pin as never]).pins[0].issues.map(issue => issue.code);

test("content readiness rules use exact code-point and destination boundaries", () => {
  assert.deepEqual(codes(ready()), []);
  assert.equal(codes(ready({ title: "x".repeat(100) })).includes("TITLE_TOO_LONG"), false);
  assert.equal(codes(ready({ title: "x".repeat(101) })).includes("TITLE_TOO_LONG"), true);
  assert.equal(codes(ready({ title: "😀".repeat(100) })).includes("TITLE_TOO_LONG"), false);
  assert.equal(codes(ready({ title: "😀".repeat(101) })).includes("TITLE_TOO_LONG"), true);
  assert.equal(codes(ready({ description: "x".repeat(800) })).includes("DESCRIPTION_TOO_LONG"), false);
  assert.equal(codes(ready({ description: "x".repeat(801) })).includes("DESCRIPTION_TOO_LONG"), true);
  assert.equal(codes(ready({ description: "😀".repeat(800) })).includes("DESCRIPTION_TOO_LONG"), false);
  assert.equal(codes(ready({ description: "😀".repeat(801) })).includes("DESCRIPTION_TOO_LONG"), true);
  for (const destinationDomain of ["alivo.eu", "shop.alivo.eu", "deep.shop.alivo.eu"]) assert.equal(codes(ready({ destinationDomain })).includes("DESTINATION_OUTSIDE_ALIVO"), false);
  for (const destinationDomain of ["evilalivo.eu", "alivo.eu.evil.example"]) assert.equal(codes(ready({ destinationDomain })).includes("DESTINATION_OUTSIDE_ALIVO"), true);
});

test("all fixed single-Pin rules and fixed ordering are deterministic", () => {
  const result = auditPinterestContent([ready({ title: "", description: "", createdAt: "not-a-date", boardName: "Unknown board", destinationDomain: undefined, thumbnailPresent: false }) as never]);
  assert.deepEqual(result.pins[0].issues.map(issue => issue.code), ["TITLE_MISSING", "DESTINATION_MISSING", "DESCRIPTION_MISSING", "THUMBNAIL_MISSING", "BOARD_UNKNOWN", "CREATED_AT_INVALID"]);
  assert.deepEqual(result.pins[0].issues.map(issue => issue.level), ["Required", "Required", "Review", "Review", "Review", "Review"]);
  assert.equal(new Set(result.pins[0].issues.map(issue => issue.code)).size, result.pins[0].issues.length);
  assert.deepEqual(PINTEREST_CONTENT_AUDIT_CODES, ["TITLE_MISSING", "TITLE_TOO_LONG", "DESTINATION_MISSING", "DESTINATION_OUTSIDE_ALIVO", "DESCRIPTION_MISSING", "DESCRIPTION_TOO_LONG", "THUMBNAIL_MISSING", "BOARD_UNKNOWN", "CREATED_AT_INVALID", "DUPLICATE_TITLE", "DUPLICATE_CONTENT", "POSSIBLE_TEST_CONTENT"]);
  assert.deepEqual(auditPinterestContent([ready() as never]), auditPinterestContent([ready() as never]));
});

test("duplicate rules normalize deterministically and require distinct Pin IDs", () => {
  const duplicate = auditPinterestContent([
    ready({ pinId: "a", title: "  Café   Guide ", description: "Same", destinationDomain: "www.alivo.eu" }),
    ready({ pinId: "b", title: "CAFE\u0301 GUIDE", description: " same ", destinationDomain: "WWW.ALIVO.EU" }),
  ] as never);
  for (const pin of duplicate.pins) assert.deepEqual(pin.issues.map(issue => issue.code), ["DUPLICATE_TITLE", "DUPLICATE_CONTENT"]);
  const sameId = auditPinterestContent([ready({ pinId: "a" }), ready({ pinId: "a" })] as never);
  assert.equal(sameId.pins.some(pin => pin.issues.some(issue => issue.code === "DUPLICATE_CONTENT")), false);
  const emptyContent = auditPinterestContent([
    ready({ pinId: "empty-a", title: "", description: "", destinationDomain: undefined }),
    ready({ pinId: "empty-b", title: "", description: "", destinationDomain: undefined }),
  ] as never);
  assert.equal(emptyContent.pins.every(pin => pin.issues.some(issue => issue.code === "DUPLICATE_CONTENT")), true);
});

test("placeholder matching is Unicode-aware and transparent", () => {
  assert.equal(codes(ready({ title: "testosterone" })).includes("POSSIBLE_TEST_CONTENT"), false);
  for (const title of ["test", "testing", "testpin", "untitled", "lorem ipsum", "Before—TEST—after"]) {
    assert.equal(codes(ready({ title })).includes("POSSIBLE_TEST_CONTENT"), true, title);
  }
});

test("audit is bounded, immutable, and contains no sensitive or provider fields", () => {
  const input = Array.from({ length: 30 }, (_, index) => ready({
    pinId: `pin-${index}`,
    accessToken: "secret",
    providerPayload: { raw: true },
    providerUrl: "sensitive-provider-location",
    thumbnailBase64: "private-image",
    media: { sourceLocation: "sensitive-provider-location" },
    boardId: "numeric-board-id",
  }));
  const result = auditPinterestContent(input as never);
  assert.equal(result.pins.length, 25);
  assert.equal(result.analyzedPins, 25);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pins), true);
  assert.equal(Object.isFrozen(result.pins[0].issues), true);
  assert.equal(/score|url|base64|image|media|boardId|token|oauth|provider|secret|numeric-board-id|pinimg/i.test(JSON.stringify(result)), false);
  assert.equal("score" in result, false);
});
