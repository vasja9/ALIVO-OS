import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import type { ContentOpportunityEvidenceAdapter } from "./ContentOpportunityEvidenceAdapter.ts";
import { canonicalLanguage, canonicalMarket } from "./LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum WebResearchEvidenceStatus {
  Verified = "Verified",
  Unverified = "Unverified",
  Rejected = "Rejected",
  Unknown = "Unknown",
}

export enum WebResearchEvidenceValidity {
  Current = "Current",
  Stale = "Stale",
  Invalid = "Invalid",
  Unknown = "Unknown",
}

export enum WebResearchSourceQuality {
  High = "High",
  Moderate = "Moderate",
  Low = "Low",
  Unknown = "Unknown",
}

export enum WebResearchEvidenceConfidence {
  High = "High",
  Moderate = "Moderate",
  Low = "Low",
  Unknown = "Unknown",
}

export enum WebResearchEvidenceNormalizationStatus {
  Normalized = "Normalized",
  Missing = "Missing",
  Insufficient = "Insufficient",
  Invalid = "Invalid",
  Stale = "Stale",
}

export interface WebResearchEvidenceInput {
  readonly businessPackageId: BusinessPackageId;
  readonly topic?: string;
  readonly contentReference?: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
  readonly publishedAt?: Date;
  readonly observedAt?: Date;
  readonly language: string;
  readonly market: string;
  readonly targetLanguage?: string;
  readonly targetMarket?: string;
  readonly crossLanguageResearch?: boolean;
  readonly role?: ContentOpportunityEvidenceRole;
  readonly relevanceExplanation: string;
  readonly sourceQuality: WebResearchSourceQuality;
  readonly evidenceConfidence: WebResearchEvidenceConfidence;
  readonly evidenceStatus: WebResearchEvidenceStatus;
  readonly validity: WebResearchEvidenceValidity;
}

export interface WebResearchEvidenceNormalization {
  readonly status: WebResearchEvidenceNormalizationStatus;
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

const result = (
  status: WebResearchEvidenceNormalizationStatus,
  reason: string,
  evidence?: ContentOpportunityEvidenceReference,
): WebResearchEvidenceNormalization => Object.freeze({ status, reason, evidence });

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

const validQuality = (value: WebResearchSourceQuality): boolean =>
  value === WebResearchSourceQuality.High || value === WebResearchSourceQuality.Moderate;

const validConfidence = (value: WebResearchEvidenceConfidence): boolean =>
  value === WebResearchEvidenceConfidence.High || value === WebResearchEvidenceConfidence.Moderate;

const safeHttpUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

export class WebResearchContentOpportunityEvidenceAdapter
  implements ContentOpportunityEvidenceAdapter<WebResearchEvidenceInput, WebResearchEvidenceNormalization>
{
  normalize(
    input: WebResearchEvidenceInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): WebResearchEvidenceNormalization {
    if (!(expectedBusinessPackageId instanceof BusinessPackageId)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Target Business Package is invalid.");
    }
    if (input === undefined || input === null) {
      return result(WebResearchEvidenceNormalizationStatus.Missing, "Web Research evidence is missing.");
    }
    if (typeof input !== "object") {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research evidence input is invalid.");
    }
    if (!(input.businessPackageId instanceof BusinessPackageId)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research evidence Business Package is invalid.");
    }
    if (input.businessPackageId.value !== expectedBusinessPackageId.value) {
      return result(
        WebResearchEvidenceNormalizationStatus.Invalid,
        "Web Research evidence crosses a Business Package boundary.",
      );
    }

    const sourceUrl = nonEmpty(input.sourceUrl) ? safeHttpUrl(input.sourceUrl) : undefined;
    if (!sourceUrl || !nonEmpty(input.sourceTitle)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research source URL and title are required.");
    }
    if (!nonEmpty(input.topic) && !nonEmpty(input.contentReference)) {
      return result(
        WebResearchEvidenceNormalizationStatus.Invalid,
        "Web Research topic or content reference is required.",
      );
    }
    if (!nonEmpty(input.language) || !nonEmpty(input.market)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research language and market are required.");
    }
    if (!nonEmpty(input.relevanceExplanation)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research relevance explanation is required.");
    }
    if (
      !Object.values(WebResearchEvidenceStatus).includes(input.evidenceStatus)
      || !Object.values(WebResearchEvidenceValidity).includes(input.validity)
      || !Object.values(WebResearchSourceQuality).includes(input.sourceQuality)
      || !Object.values(WebResearchEvidenceConfidence).includes(input.evidenceConfidence)
    ) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research status, validity, quality, and confidence are required.");
    }
    if (input.evidenceStatus === WebResearchEvidenceStatus.Rejected || input.validity === WebResearchEvidenceValidity.Invalid) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research evidence is rejected or invalid.");
    }
    if (input.validity === WebResearchEvidenceValidity.Stale) {
      return result(WebResearchEvidenceNormalizationStatus.Stale, "Web Research evidence is stale.");
    }
    if (input.evidenceStatus !== WebResearchEvidenceStatus.Verified || !validQuality(input.sourceQuality) || !validConfidence(input.evidenceConfidence)) {
      return result(
        WebResearchEvidenceNormalizationStatus.Insufficient,
        "Web Research evidence is not sufficiently verified or trusted.",
      );
    }
    if (input.publishedAt !== undefined && !validDate(input.publishedAt)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research publication timestamp is invalid.");
    }
    if (input.observedAt !== undefined && !validDate(input.observedAt)) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research observation timestamp is invalid.");
    }
    if (input.publishedAt === undefined && input.observedAt === undefined) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research publication or observation timestamp is required.");
    }

    const observedAt = input.observedAt ?? input.publishedAt!;
    if (input.publishedAt !== undefined && input.publishedAt.getTime() > observedAt.getTime()) {
      return result(WebResearchEvidenceNormalizationStatus.Invalid, "Web Research publication timestamp follows observation timestamp.");
    }

    try {
      const researchLanguage = canonicalLanguage(input.language, "Web Research language");
      const targetLanguage = canonicalLanguage(input.targetLanguage ?? input.language, "Web Research target language");
      const targetMarket = canonicalMarket(input.targetMarket ?? input.market, "Web Research target market");
      const crossLanguageResearch = input.crossLanguageResearch ?? false;
      if (crossLanguageResearch && (input.targetLanguage === undefined || input.targetMarket === undefined)) {
        return result(
          WebResearchEvidenceNormalizationStatus.Invalid,
          "Cross-language Web Research requires an explicit target language and target market.",
        );
      }
      if (crossLanguageResearch && researchLanguage === targetLanguage) {
        return result(
          WebResearchEvidenceNormalizationStatus.Invalid,
          "Cross-language Web Research requires a different research language.",
        );
      }
      if (!crossLanguageResearch && input.targetLanguage !== undefined && researchLanguage !== targetLanguage) {
        return result(
          WebResearchEvidenceNormalizationStatus.Invalid,
          "A different Web Research language must be explicitly marked as cross-language research.",
        );
      }
      const subject = input.contentReference?.trim() || `topic:${input.topic!.trim()}`;
      const explanation = [
        `Web source "${input.sourceTitle.trim()}" (${sourceUrl})`,
        `is relevant to ${subject}`,
        `for ${targetLanguage}/${targetMarket}`,
        crossLanguageResearch ? `researched in ${researchLanguage}` : "",
        `because ${input.relevanceExplanation.trim()}`,
        `; source quality=${input.sourceQuality}, evidence confidence=${input.evidenceConfidence}`,
        input.publishedAt ? `, published=${input.publishedAt.toISOString()}` : "",
        `, observed=${observedAt.toISOString()}`,
      ].join(" ");
      const evidence = new ContentOpportunityEvidenceReference({
        businessPackageId: expectedBusinessPackageId,
        source: ContentOpportunityEvidenceSource.Web,
        sourceReference: `web-research:${expectedBusinessPackageId.value}:source:${encodeURIComponent(sourceUrl)}:scope:${targetLanguage}:${targetMarket}`,
        evidenceReference: `web-research-observation:${expectedBusinessPackageId.value}:${encodeURIComponent(subject)}:${observedAt.toISOString()}:scope:${targetLanguage}:${targetMarket}`,
        language: targetLanguage,
        market: targetMarket,
        researchLanguage: crossLanguageResearch ? researchLanguage : undefined,
        crossLanguageResearch,
        sourceQuality: input.sourceQuality,
        evidenceConfidence: input.evidenceConfidence,
        role: input.role ?? ContentOpportunityEvidenceRole.Supporting,
        explanation,
        observedAt,
      });
      return result(
        WebResearchEvidenceNormalizationStatus.Normalized,
        "Web Research evidence was normalized.",
        evidence,
      );
    } catch (error) {
      return result(
        WebResearchEvidenceNormalizationStatus.Invalid,
        error instanceof Error ? error.message : "Web Research evidence is invalid.",
      );
    }
  }

  normalizeMany(
    inputs: readonly (WebResearchEvidenceInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly WebResearchEvidenceNormalization[] {
    return Object.freeze(inputs.map((input) => this.normalize(input, expectedBusinessPackageId)));
  }
}