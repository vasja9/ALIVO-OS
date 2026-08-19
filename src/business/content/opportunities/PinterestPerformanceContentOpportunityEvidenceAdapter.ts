import { MetricAvailability } from "../../market/performance/PerformanceIntelligenceDomain.ts";
import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import type { ContentOpportunityEvidenceAdapter } from "./ContentOpportunityEvidenceAdapter.ts";
import { canonicalLanguage, canonicalMarket } from "./LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum PinterestPerformancePublicationStatus {
  Published = "Published",
  Draft = "Draft",
  Failed = "Failed",
  Unknown = "Unknown",
}

export type PinterestPerformanceSignalName =
  | "Impressions"
  | "Clicks"
  | "OutboundClicks"
  | "Saves"
  | "CTR"
  | "Engagement"
  | "Reach"
  | "Shares"
  | "Comments";

export interface PinterestPerformanceSignalInput {
  readonly name: PinterestPerformanceSignalName;
  readonly value?: number;
  readonly unit?: string;
  readonly availability: MetricAvailability;
}

export interface PinterestPerformanceEvidenceInput {
  readonly businessPackageId: BusinessPackageId;
  readonly pinReference: string;
  readonly publicationReference: string;
  readonly publicationStatus: PinterestPerformancePublicationStatus;
  readonly contentReference?: string;
  readonly topic?: string;
  readonly destinationReference?: string;
  readonly language: string;
  readonly market: string;
  readonly signals: readonly PinterestPerformanceSignalInput[];
  readonly role?: ContentOpportunityEvidenceRole;
  readonly explanation?: string;
  readonly observedAt: Date;
}

export enum PinterestPerformanceEvidenceNormalizationStatus {
  Normalized = "Normalized",
  Missing = "Missing",
  Insufficient = "Insufficient",
  Invalid = "Invalid",
}

export interface PinterestPerformanceEvidenceNormalization {
  readonly status: PinterestPerformanceEvidenceNormalizationStatus;
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

const normalizedResult = (
  status: PinterestPerformanceEvidenceNormalizationStatus,
  reason: string,
  evidence?: ContentOpportunityEvidenceReference,
): PinterestPerformanceEvidenceNormalization => Object.freeze({ status, reason, evidence });

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const defaultUnit: Readonly<Record<PinterestPerformanceSignalName, string>> = Object.freeze({
  Impressions: "count",
  Clicks: "count",
  OutboundClicks: "count",
  Saves: "count",
  CTR: "ratio",
  Engagement: "count",
  Reach: "count",
  Shares: "count",
  Comments: "count",
});

const available = (availability: MetricAvailability): boolean =>
  availability === MetricAvailability.Available || availability === MetricAvailability.Estimated;

const invalidSignal = (signal: PinterestPerformanceSignalInput): boolean => {
  if (!Object.hasOwn(defaultUnit, signal.name)) return true;
  if (!Object.values(MetricAvailability).includes(signal.availability)) return true;
  if (signal.unit !== undefined && !nonEmpty(signal.unit)) return true;
  if (available(signal.availability)) {
    return signal.value === undefined || !Number.isFinite(signal.value) || signal.value < 0;
  }
  return signal.value !== undefined;
};

export class PinterestPerformanceContentOpportunityEvidenceAdapter
  implements ContentOpportunityEvidenceAdapter<PinterestPerformanceEvidenceInput, PinterestPerformanceEvidenceNormalization>
{
  normalize(
    input: PinterestPerformanceEvidenceInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): PinterestPerformanceEvidenceNormalization {
    if (!(expectedBusinessPackageId instanceof BusinessPackageId)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Target Business Package is invalid.",
      );
    }
    if (input === undefined || input === null) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Missing,
        "Pinterest Performance evidence is missing.",
      );
    }
    if (typeof input !== "object") {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance evidence input is invalid.",
      );
    }
    if (!(input.businessPackageId instanceof BusinessPackageId)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance evidence Business Package is invalid.",
      );
    }
    if (input.businessPackageId.value !== expectedBusinessPackageId.value) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance evidence crosses a Business Package boundary.",
      );
    }
    if (!nonEmpty(input.pinReference) || !nonEmpty(input.publicationReference)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Published Pin and publication references are required.",
      );
    }
    if (input.publicationStatus !== PinterestPerformancePublicationStatus.Published) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance evidence requires a published Pin.",
      );
    }
    if (!nonEmpty(input.language) || !nonEmpty(input.market)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance language and market are required.",
      );
    }
    if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance observation timestamp is invalid.",
      );
    }
    const rawSignals: unknown = input.signals;
    if (!Array.isArray(rawSignals)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance signals are invalid.",
      );
    }
    const signals = rawSignals as readonly PinterestPerformanceSignalInput[];
    if (signals.length === 0) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Insufficient,
        "Pinterest Performance signals are missing.",
      );
    }
    if (signals.some(invalidSignal)) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        "Pinterest Performance signal values are invalid.",
      );
    }

    const measuredSignals = signals.filter((signal) => available(signal.availability) && signal.value !== undefined);
    if (measuredSignals.length === 0) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Insufficient,
        "Pinterest Performance has no available content-performance signals.",
      );
    }

    try {
      const pinReference = input.pinReference.trim();
      const publicationReference = input.publicationReference.trim();
      const language = canonicalLanguage(input.language, "Pinterest Performance evidence language");
      const market = canonicalMarket(input.market, "Pinterest Performance evidence market");
      const sortedSignals = [...signals].sort((left, right) => left.name.localeCompare(right.name));
      const signalSummary = sortedSignals
        .map((signal) =>
          `${signal.name}=${signal.value === undefined ? signal.availability : `${signal.value} ${signal.unit ?? defaultUnit[signal.name]}`}`,
        )
        .join(", ");
      const context = [
        input.contentReference,
        input.topic ? `topic=${input.topic}` : undefined,
        input.destinationReference ? `destination=${input.destinationReference}` : undefined,
      ].filter(nonEmpty).join("; ");
      const explanation = input.explanation?.trim()
        || `Pinterest Performance for published Pin ${pinReference} and publication ${publicationReference}; ${context ? `${context}; ` : ""}content-performance signals: ${signalSummary}; observed for ${input.language}/${input.market}.`;
      const evidence = new ContentOpportunityEvidenceReference({
        businessPackageId: expectedBusinessPackageId,
        source: ContentOpportunityEvidenceSource.PinterestPerformance,
        sourceReference: `pinterest-performance:${expectedBusinessPackageId.value}:publication:${publicationReference}:pin:${pinReference}:scope:${language}:${market}`,
        evidenceReference: `pinterest-performance-observation:${expectedBusinessPackageId.value}:${publicationReference}:${pinReference}:${input.observedAt.toISOString()}:scope:${language}:${market}`,
        language,
        market,
        role: input.role ?? ContentOpportunityEvidenceRole.Supporting,
        explanation,
        observedAt: input.observedAt,
      });
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Normalized,
        "Pinterest Performance evidence was normalized.",
        evidence,
      );
    } catch (error) {
      return normalizedResult(
        PinterestPerformanceEvidenceNormalizationStatus.Invalid,
        error instanceof Error ? error.message : "Pinterest Performance evidence is invalid.",
      );
    }
  }

  normalizeMany(
    inputs: readonly (PinterestPerformanceEvidenceInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly PinterestPerformanceEvidenceNormalization[] {
    return Object.freeze(inputs.map((input) => this.normalize(input, expectedBusinessPackageId)));
  }
}