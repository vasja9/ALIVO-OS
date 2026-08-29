const UTC_DAY_MS = 86_400_000;

export const PINTEREST_PIN_AGE_COHORTS = Object.freeze([
  "Days0To59",
  "Days60To90",
  "Days91To180",
  "Days181To600",
  "Days601Plus",
  "Unknown",
] as const);

export type PinterestPinAgeCohort = typeof PINTEREST_PIN_AGE_COHORTS[number];
export type PinterestObservedOutboundState = "ReachedAlivoEu" | "NoOutboundClickInWindow" | "Unavailable";

export interface PinterestPinLifecycleEvidence {
  readonly createdAt: string | null;
  readonly completedAgeDays: number | null;
  readonly cohort: PinterestPinAgeCohort;
  readonly outboundState: PinterestObservedOutboundState;
  readonly coverage: "Observed30CompletedUtcDays";
}

const exactUtcInstant = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
};

const endExclusiveUtc = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed.getTime() + UTC_DAY_MS;
};

export function pinterestPinAgeCohort(completedAgeDays: number | null): PinterestPinAgeCohort {
  if (!Number.isSafeInteger(completedAgeDays) || completedAgeDays === null || completedAgeDays < 0) return "Unknown";
  if (completedAgeDays <= 59) return "Days0To59";
  if (completedAgeDays <= 90) return "Days60To90";
  if (completedAgeDays <= 180) return "Days91To180";
  if (completedAgeDays <= 600) return "Days181To600";
  return "Days601Plus";
}

export function pinterestPinLifecycleEvidence(createdAtValue: unknown, windowEndDate: unknown, outboundClicks: unknown): PinterestPinLifecycleEvidence {
  const createdAt = exactUtcInstant(createdAtValue);
  const endExclusive = endExclusiveUtc(windowEndDate);
  const createdAtMs = createdAt === null ? null : Date.parse(createdAt);
  const calculatedAge = createdAtMs !== null && endExclusive !== null && createdAtMs < endExclusive ? Math.floor((endExclusive - createdAtMs) / UTC_DAY_MS) : null;
  const completedAgeDays = calculatedAge !== null && Number.isSafeInteger(calculatedAge) && calculatedAge >= 0 ? calculatedAge : null;
  const outboundState: PinterestObservedOutboundState = typeof outboundClicks === "number" && Number.isSafeInteger(outboundClicks) && outboundClicks >= 0
    ? outboundClicks > 0 ? "ReachedAlivoEu" : "NoOutboundClickInWindow"
    : "Unavailable";
  return Object.freeze({
    createdAt: completedAgeDays === null ? null : createdAt,
    completedAgeDays,
    cohort: pinterestPinAgeCohort(completedAgeDays),
    outboundState,
    coverage: "Observed30CompletedUtcDays",
  });
}
