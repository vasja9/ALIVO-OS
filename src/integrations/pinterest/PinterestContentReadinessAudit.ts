export const PINTEREST_CONTENT_AUDIT_CODES = Object.freeze([
  "TITLE_MISSING",
  "TITLE_TOO_LONG",
  "DESTINATION_MISSING",
  "DESTINATION_OUTSIDE_ALIVO",
  "DESCRIPTION_MISSING",
  "DESCRIPTION_TOO_LONG",
  "THUMBNAIL_MISSING",
  "BOARD_UNKNOWN",
  "CREATED_AT_INVALID",
  "DUPLICATE_TITLE",
  "DUPLICATE_CONTENT",
  "POSSIBLE_TEST_CONTENT",
] as const);

export type PinterestContentAuditCode = typeof PINTEREST_CONTENT_AUDIT_CODES[number];
export type PinterestContentAuditState = "NotRead" | "Available" | "TemporarilyUnavailable";

export interface PinterestContentAuditInput {
  readonly pinId: string;
  readonly title?: string;
  readonly description?: string;
  readonly createdAt?: string;
  readonly boardName?: string;
  readonly destinationDomain?: string;
  readonly thumbnailPresent: boolean;
}

export interface PinterestContentAuditIssue {
  readonly code: PinterestContentAuditCode;
  readonly level: "Required" | "Review";
  readonly message: string;
}

export interface PinterestContentAuditPin {
  readonly pinId: string;
  readonly status: "Ready" | "NeedsAttention";
  readonly issues: readonly PinterestContentAuditIssue[];
}

export interface PinterestContentAuditResult {
  readonly state: PinterestContentAuditState;
  readonly analyzedPins: number;
  readonly readyPins: number;
  readonly attentionPins: number;
  readonly issueCounts: Readonly<Record<PinterestContentAuditCode, number>>;
  readonly pins: readonly PinterestContentAuditPin[];
}

const RULES: Readonly<Record<PinterestContentAuditCode, Readonly<{ level: "Required" | "Review"; message: string }>>> = Object.freeze({
  TITLE_MISSING: Object.freeze({ level: "Required", message: "Add a Pin title." }),
  TITLE_TOO_LONG: Object.freeze({ level: "Required", message: "Shorten the title to 100 characters or fewer." }),
  DESTINATION_MISSING: Object.freeze({ level: "Required", message: "Add a destination to alivo.eu." }),
  DESTINATION_OUTSIDE_ALIVO: Object.freeze({ level: "Required", message: "Review the destination: it is outside alivo.eu." }),
  DESCRIPTION_MISSING: Object.freeze({ level: "Review", message: "Add a Pin description for Pinterest relevance." }),
  DESCRIPTION_TOO_LONG: Object.freeze({ level: "Review", message: "Shorten the description to 800 characters or fewer." }),
  THUMBNAIL_MISSING: Object.freeze({ level: "Review", message: "Add or repair the Pin image." }),
  BOARD_UNKNOWN: Object.freeze({ level: "Review", message: "Resolve the Pinterest board name." }),
  CREATED_AT_INVALID: Object.freeze({ level: "Review", message: "Review the creation date." }),
  DUPLICATE_TITLE: Object.freeze({ level: "Review", message: "Review Pins that use the same title." }),
  DUPLICATE_CONTENT: Object.freeze({ level: "Review", message: "Review Pins with identical content." }),
  POSSIBLE_TEST_CONTENT: Object.freeze({ level: "Review", message: "Remove test or placeholder content before publishing." }),
});

const emptyCounts = (): Record<PinterestContentAuditCode, number> => Object.fromEntries(PINTEREST_CONTENT_AUDIT_CODES.map(code => [code, 0])) as Record<PinterestContentAuditCode, number>;
const normalizedText = (value: unknown): string => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
const duplicateText = (value: unknown): string => normalizedText(value).toLowerCase();
const codePoints = (value: string): number => Array.from(value).length;
const canonicalDate = (value: unknown): boolean => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
const alivoDomain = (value: string): boolean => value === "alivo.eu" || value.endsWith(".alivo.eu");
const placeholderContent = (title: string, description: string): boolean => {
  const tokens = duplicateText(`${title} ${description}`).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.some(token => ["test", "testing", "testpin", "untitled"].includes(token))) return true;
  return tokens.some((token, index) => token === "lorem" && tokens[index + 1] === "ipsum");
};
const validPinId = (value: unknown): string | undefined => typeof value === "string" && value.trim() && value.trim().length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : undefined;

export function emptyPinterestContentAudit(state: PinterestContentAuditState = "NotRead"): PinterestContentAuditResult {
  return Object.freeze({ state, analyzedPins: 0, readyPins: 0, attentionPins: 0, issueCounts: Object.freeze(emptyCounts()), pins: Object.freeze([]) });
}

export function withPinterestContentAuditState(result: PinterestContentAuditResult, state: PinterestContentAuditState): PinterestContentAuditResult {
  return Object.freeze({ ...result, state });
}

export function auditPinterestContent(input: readonly PinterestContentAuditInput[]): PinterestContentAuditResult {
  const seenPinIds = new Set<string>();
  const pins = input.flatMap(pin => {
    const pinId = validPinId(pin?.pinId);
    if (!pinId || seenPinIds.has(pinId) || seenPinIds.size >= 25) return [];
    seenPinIds.add(pinId);
    return [{ ...pin, pinId }];
  });
  const titles = new Map<string, Set<string>>();
  const content = new Map<string, Set<string>>();
  for (const pin of pins) {
    const title = duplicateText(pin.title);
    const description = duplicateText(pin.description);
    const domain = duplicateText(pin.destinationDomain);
    if (title) (titles.get(title) ?? titles.set(title, new Set()).get(title))?.add(pin.pinId);
    const key = JSON.stringify([title, description, domain]);
    (content.get(key) ?? content.set(key, new Set()).get(key))?.add(pin.pinId);
  }
  const counts = emptyCounts();
  const audited = pins.map(pin => {
    const title = normalizedText(pin.title);
    const description = normalizedText(pin.description);
    const domain = duplicateText(pin.destinationDomain);
    const codes = new Set<PinterestContentAuditCode>();
    if (!title) codes.add("TITLE_MISSING");
    else if (codePoints(title) > 100) codes.add("TITLE_TOO_LONG");
    if (!domain) codes.add("DESTINATION_MISSING");
    else if (!alivoDomain(domain)) codes.add("DESTINATION_OUTSIDE_ALIVO");
    if (!description) codes.add("DESCRIPTION_MISSING");
    else if (codePoints(description) > 800) codes.add("DESCRIPTION_TOO_LONG");
    if (pin.thumbnailPresent !== true) codes.add("THUMBNAIL_MISSING");
    if (!normalizedText(pin.boardName) || normalizedText(pin.boardName) === "Unknown board") codes.add("BOARD_UNKNOWN");
    if (!canonicalDate(pin.createdAt)) codes.add("CREATED_AT_INVALID");
    const titleKey = duplicateText(title);
    if (titleKey && (titles.get(titleKey)?.size ?? 0) > 1) codes.add("DUPLICATE_TITLE");
    const contentKey = JSON.stringify([titleKey, duplicateText(description), domain]);
    if ((content.get(contentKey)?.size ?? 0) > 1) codes.add("DUPLICATE_CONTENT");
    if (placeholderContent(title, description)) codes.add("POSSIBLE_TEST_CONTENT");
    const issues = PINTEREST_CONTENT_AUDIT_CODES.filter(code => codes.has(code)).map(code => {
      counts[code] += 1;
      return Object.freeze({ code, ...RULES[code] });
    });
    return Object.freeze({ pinId: pin.pinId, status: issues.length ? "NeedsAttention" as const : "Ready" as const, issues: Object.freeze(issues) });
  });
  const attentionPins = audited.filter(pin => pin.status === "NeedsAttention").length;
  return Object.freeze({
    state: "Available",
    analyzedPins: audited.length,
    readyPins: audited.length - attentionPins,
    attentionPins,
    issueCounts: Object.freeze(counts),
    pins: Object.freeze(audited),
  });
}
