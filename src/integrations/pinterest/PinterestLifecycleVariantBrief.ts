const UTC_DAY_MS = 86_400_000;

export const PINTEREST_LIFECYCLE_VARIANT_COHORTS = Object.freeze([
  "Days60To90",
  "Days91To180",
  "Days181To600",
] as const);

export const PINTEREST_LIFECYCLE_VARIANT_REQUIRED_CHANGES = Object.freeze([
  "BackgroundStyle",
  "VisibleText",
  "Typography",
] as const);

export const MAX_PIN_FAMILY_MEMBERS = 4;
export const MIN_VARIANT_BRIEF_AGE_DAYS = 60;
export const MAX_VARIANT_BRIEF_AGE_DAYS = 600;

export type PinterestLifecycleVariantCohort = typeof PINTEREST_LIFECYCLE_VARIANT_COHORTS[number];
export type PinterestLifecycleVariantRequiredChange = typeof PINTEREST_LIFECYCLE_VARIANT_REQUIRED_CHANGES[number];
export type PinterestLifecycleVariantDestinationType = "ExistingArticle" | "ExistingBook" | "ExistingProduct" | "ExistingLandingPage";

export interface PinterestLifecycleEvidenceSummaryInput {
  readonly createdAt: string | null;
  readonly completedAgeDays: number | null;
  readonly observedWindowCount: number;
  readonly firstObservedDate: string | null;
  readonly lastObservedDate: string | null;
  readonly totalOutboundClicks: number;
  readonly continuity: string;
  readonly variantEligibility: string;
}

export interface PinterestLifecycleVariantSourceCreative {
  readonly topic: string;
  readonly destinationType: PinterestLifecycleVariantDestinationType;
  readonly destinationUrl: string;
  readonly language: string;
  readonly market: string;
  readonly backgroundStyle: string;
  readonly visibleText: string;
  readonly fontFamily: string;
  readonly productAssetReference?: string;
}

export interface PinterestPinFamilyState {
  readonly familyReference: string;
  readonly memberCount: number;
  readonly usedCohorts: readonly PinterestLifecycleVariantCohort[];
}

export interface PinterestLifecycleVariantBriefRequest {
  readonly businessPackageId: string;
  readonly evidenceReference: string;
  readonly evidence: PinterestLifecycleEvidenceSummaryInput;
  readonly family: PinterestPinFamilyState;
  readonly sourceCreative: PinterestLifecycleVariantSourceCreative;
}

export interface PinterestLifecycleVariantBrief {
  readonly id: string;
  readonly kind: "PinterestLifecycleVariantBrief";
  readonly state: "ReadyForRecommendationReview";
  readonly businessPackageId: string;
  readonly evidenceReference: string;
  readonly family: Readonly<{
    reference: string;
    memberCountBefore: number;
    proposedVariantOrdinal: number;
    cohort: PinterestLifecycleVariantCohort;
  }>;
  readonly evidence: Readonly<{
    asOfDate: string;
    completedAgeDays: number;
    observedWindowCount: number;
    totalOutboundClicks: 0;
    interpretation: "NoOutboundClickYet";
  }>;
  readonly preserve: Readonly<{
    topic: string;
    destinationType: PinterestLifecycleVariantDestinationType;
    destinationUrl: string;
    language: string;
    market: string;
    productAssetReference: string | null;
  }>;
  readonly sourceCreative: Readonly<{
    backgroundStyle: string;
    visibleText: string;
    fontFamily: string;
  }>;
  readonly requiredChanges: readonly PinterestLifecycleVariantRequiredChange[];
  readonly originalPinDirective: "LeaveUnchanged";
  readonly nextAuthority: "RecommendationReview";
}

export class PinterestLifecycleVariantBriefError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PinterestLifecycleVariantBriefError";
  }
}

const fail = (code: string, message: string): never => {
  throw new PinterestLifecycleVariantBriefError(code, message);
};

const required = (value: unknown, field: string, maximumLength = 500): string => {
  if (typeof value !== "string") fail("INVALID_BRIEF", `${field} is required`);
  const normalized = (value as string).trim();
  if (!normalized || normalized.length > maximumLength) fail("INVALID_BRIEF", `${field} is invalid`);
  return normalized;
};

const safeReference = (value: unknown, field: string): string => {
  const normalized = required(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) fail("INVALID_BRIEF", `${field} is invalid`);
  return normalized;
};

const exactUtcDate = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("EVIDENCE_INVALID", `${field} must be an exact UTC date`);
  const normalized = value as string;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) fail("EVIDENCE_INVALID", `${field} must be an exact UTC date`);
  return normalized;
};

const exactUtcInstant = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("EVIDENCE_INVALID", `${field} must be an exact UTC instant`);
  const normalized = value as string;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) fail("EVIDENCE_INVALID", `${field} must be an exact UTC instant`);
  return normalized;
};

const exactHttpsUrl = (value: unknown): string => {
  const normalized = required(value, "Destination URL", 2_048);
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { return fail("INVALID_BRIEF", "Destination URL is invalid"); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) fail("INVALID_BRIEF", "Destination URL must be a canonical HTTPS URL");
  return parsed.toString();
};

const exactLanguage = (value: unknown): string => {
  const normalized = required(value, "Language", 35);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) fail("INVALID_BRIEF", "Language is invalid");
  return normalized;
};

const exactMarket = (value: unknown): string => {
  const normalized = required(value, "Market", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) fail("INVALID_BRIEF", "Market is invalid");
  return normalized;
};

const destinationType = (value: unknown): PinterestLifecycleVariantDestinationType => {
  if (value !== "ExistingArticle" && value !== "ExistingBook" && value !== "ExistingProduct" && value !== "ExistingLandingPage") {
    fail("INVALID_BRIEF", "Destination type is invalid");
  }
  return value as PinterestLifecycleVariantDestinationType;
};

export function pinterestLifecycleVariantCohort(completedAgeDays: number): PinterestLifecycleVariantCohort | null {
  if (!Number.isSafeInteger(completedAgeDays) || completedAgeDays < MIN_VARIANT_BRIEF_AGE_DAYS || completedAgeDays > MAX_VARIANT_BRIEF_AGE_DAYS) return null;
  if (completedAgeDays <= 90) return "Days60To90";
  if (completedAgeDays <= 180) return "Days91To180";
  return "Days181To600";
}

function validateEvidence(value: PinterestLifecycleEvidenceSummaryInput): {
  createdAt: string;
  completedAgeDays: number;
  observedWindowCount: number;
  firstObservedDate: string;
  lastObservedDate: string;
  cohort: PinterestLifecycleVariantCohort;
} {
  if (!value || typeof value !== "object") fail("EVIDENCE_INVALID", "Lifecycle evidence is required");
  if (value.variantEligibility !== "EligibleForBrief" || value.continuity !== "CompleteSincePublication" || value.totalOutboundClicks !== 0) {
    fail("NOT_ELIGIBLE", "Only complete zero-click lifecycle evidence may create a variant brief");
  }
  const createdAt = exactUtcInstant(value.createdAt, "Pin publication time");
  const firstObservedDate = exactUtcDate(value.firstObservedDate, "First observed date");
  const lastObservedDate = exactUtcDate(value.lastObservedDate, "Last observed date");
  if (firstObservedDate !== createdAt.slice(0, 10) || lastObservedDate < firstObservedDate) fail("EVIDENCE_INVALID", "Lifecycle evidence coverage is inconsistent");
  const completedAgeDaysValue = value.completedAgeDays;
  if (typeof completedAgeDaysValue !== "number" || !Number.isSafeInteger(completedAgeDaysValue)) fail("EVIDENCE_INVALID", "Completed Pin age is invalid");
  const completedAgeDays = completedAgeDaysValue as number;
  const cohort = pinterestLifecycleVariantCohort(completedAgeDays);
  if (cohort === null) fail("NOT_ELIGIBLE", "Pin age is outside the bounded lifecycle variant range");
  const observedWindowCount = value.observedWindowCount;
  if (!Number.isSafeInteger(observedWindowCount) || observedWindowCount < 2 || observedWindowCount > 20) fail("EVIDENCE_INVALID", "Observed window count is invalid");
  const inclusiveDays = (Date.parse(`${lastObservedDate}T00:00:00.000Z`) - Date.parse(`${firstObservedDate}T00:00:00.000Z`)) / UTC_DAY_MS + 1;
  if (inclusiveDays !== observedWindowCount * 30) fail("EVIDENCE_INVALID", "Lifecycle evidence windows are not continuous complete 30-day windows");
  const calculatedAge = Math.floor((Date.parse(`${lastObservedDate}T00:00:00.000Z`) + UTC_DAY_MS - Date.parse(createdAt)) / UTC_DAY_MS);
  if (calculatedAge !== completedAgeDays) fail("EVIDENCE_INVALID", "Completed Pin age conflicts with lifecycle evidence dates");
  return { createdAt, completedAgeDays, observedWindowCount, firstObservedDate, lastObservedDate, cohort: cohort as PinterestLifecycleVariantCohort };
}

function validateFamily(value: PinterestPinFamilyState, currentCohort: PinterestLifecycleVariantCohort): {
  familyReference: string;
  memberCount: number;
} {
  if (!value || typeof value !== "object") fail("INVALID_FAMILY", "Pin family is required");
  const familyReference = safeReference(value.familyReference, "Pin family reference");
  if (!Number.isSafeInteger(value.memberCount) || value.memberCount < 1 || value.memberCount > MAX_PIN_FAMILY_MEMBERS) fail("INVALID_FAMILY", "Pin family member count is invalid");
  if (!Array.isArray(value.usedCohorts) || value.usedCohorts.some((cohort) => !PINTEREST_LIFECYCLE_VARIANT_COHORTS.includes(cohort))) fail("INVALID_FAMILY", "Pin family cohorts are invalid");
  const unique = new Set(value.usedCohorts);
  if (unique.size !== value.usedCohorts.length || value.memberCount !== unique.size + 1) fail("INVALID_FAMILY", "Pin family history is inconsistent");
  if (value.memberCount >= MAX_PIN_FAMILY_MEMBERS) fail("FAMILY_LIMIT_REACHED", "Pin family already contains the maximum four members");
  if (unique.has(currentCohort)) fail("COHORT_ALREADY_USED", "Pin family already has a variant brief for this lifecycle cohort");
  const currentRank = PINTEREST_LIFECYCLE_VARIANT_COHORTS.indexOf(currentCohort);
  if (value.usedCohorts.some((cohort) => PINTEREST_LIFECYCLE_VARIANT_COHORTS.indexOf(cohort) >= currentRank)) fail("INVALID_FAMILY", "Pin family cohort history is not chronological");
  return { familyReference, memberCount: value.memberCount };
}

export function createPinterestLifecycleVariantBrief(request: PinterestLifecycleVariantBriefRequest): PinterestLifecycleVariantBrief {
  if (!request || typeof request !== "object") fail("INVALID_BRIEF", "Variant brief request is required");
  const evidence = validateEvidence(request.evidence);
  const family = validateFamily(request.family, evidence.cohort);
  const source = request.sourceCreative;
  if (!source || typeof source !== "object") fail("INVALID_BRIEF", "Source creative is required");
  const businessPackageId = safeReference(request.businessPackageId, "Business Package");
  const evidenceReference = safeReference(request.evidenceReference, "Evidence reference");
  const topic = required(source.topic, "Topic", 300);
  const type = destinationType(source.destinationType);
  const destinationUrl = exactHttpsUrl(source.destinationUrl);
  const language = exactLanguage(source.language);
  const market = exactMarket(source.market);
  const backgroundStyle = required(source.backgroundStyle, "Background style", 100);
  const visibleText = required(source.visibleText, "Visible text", 500);
  const fontFamily = required(source.fontFamily, "Font family", 100);
  const productAssetReference = source.productAssetReference === undefined ? null : safeReference(source.productAssetReference, "Product asset reference");
  const id = `lifecycle-variant:${family.familyReference}:${evidence.cohort}`;
  return Object.freeze({
    id,
    kind: "PinterestLifecycleVariantBrief",
    state: "ReadyForRecommendationReview",
    businessPackageId,
    evidenceReference,
    family: Object.freeze({ reference: family.familyReference, memberCountBefore: family.memberCount, proposedVariantOrdinal: family.memberCount, cohort: evidence.cohort }),
    evidence: Object.freeze({ asOfDate: evidence.lastObservedDate, completedAgeDays: evidence.completedAgeDays, observedWindowCount: evidence.observedWindowCount, totalOutboundClicks: 0, interpretation: "NoOutboundClickYet" }),
    preserve: Object.freeze({ topic, destinationType: type, destinationUrl, language, market, productAssetReference }),
    sourceCreative: Object.freeze({ backgroundStyle, visibleText, fontFamily }),
    requiredChanges: PINTEREST_LIFECYCLE_VARIANT_REQUIRED_CHANGES,
    originalPinDirective: "LeaveUnchanged",
    nextAuthority: "RecommendationReview",
  });
}
