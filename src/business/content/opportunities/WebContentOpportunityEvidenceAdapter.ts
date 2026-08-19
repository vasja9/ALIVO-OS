import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import type { ContentOpportunityEvidenceAdapter } from "./ContentOpportunityEvidenceAdapter.ts";
import { canonicalLanguage, canonicalMarket } from "./LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum WebEvidenceNormalizationStatus {
  Normalized = "Normalized",
  Missing = "Missing",
  Invalid = "Invalid",
}

export interface WebEvidenceInput {
  readonly businessPackageId: BusinessPackageId;
  readonly url: string;
  readonly language: string;
  readonly market: string;
  readonly researchLanguage?: string;
  readonly crossLanguageResearch?: boolean;
  readonly sourceQuality?: string;
  readonly evidenceConfidence?: string;
  readonly role?: ContentOpportunityEvidenceRole;
  readonly explanation?: string;
  readonly observedAt?: Date;
}

export interface WebEvidenceNormalization {
  readonly status: WebEvidenceNormalizationStatus;
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

const result = (
  status: WebEvidenceNormalizationStatus,
  reason: string,
  evidence?: ContentOpportunityEvidenceReference,
): WebEvidenceNormalization => Object.freeze({ status, reason, evidence });

export class WebContentOpportunityEvidenceAdapter
  implements ContentOpportunityEvidenceAdapter<WebEvidenceInput, WebEvidenceNormalization>
{
  normalize(
    input: WebEvidenceInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): WebEvidenceNormalization {
    if (!(expectedBusinessPackageId instanceof BusinessPackageId)) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Target Business Package is invalid.");
    }
    if (input === undefined || input === null) {
      return result(WebEvidenceNormalizationStatus.Missing, "Web evidence is missing.");
    }
    if (typeof input !== "object") {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence input is invalid.");
    }
    if (!(input.businessPackageId instanceof BusinessPackageId)) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence Business Package is invalid.");
    }
    if (input.businessPackageId.value !== expectedBusinessPackageId.value) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence crosses a Business Package boundary.");
    }
    if (typeof input.url !== "string" || input.url.trim().length === 0) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence URL is required.");
    }
    if (typeof input.language !== "string" || input.language.trim().length === 0) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence language is required.");
    }
    if (typeof input.market !== "string" || input.market.trim().length === 0) {
      return result(WebEvidenceNormalizationStatus.Invalid, "Web evidence market is required.");
    }

    try {
      const language = canonicalLanguage(input.language, "Web evidence language");
      const market = canonicalMarket(input.market, "Web evidence market");
      const researchLanguage = input.researchLanguage === undefined
        ? undefined
        : canonicalLanguage(input.researchLanguage, "Web evidence research language");
      const crossLanguageResearch = input.crossLanguageResearch ?? false;
      const researchLanguageReference = crossLanguageResearch && researchLanguage !== undefined
        ? `:research-language:${researchLanguage}`
        : "";
      const evidence = new ContentOpportunityEvidenceReference({
        businessPackageId: expectedBusinessPackageId,
        source: ContentOpportunityEvidenceSource.Web,
        sourceReference: `web:${expectedBusinessPackageId.value}:url:${input.url.trim()}:scope:${language}:${market}${researchLanguageReference}`,
        evidenceReference: `web:${expectedBusinessPackageId.value}:url:${input.url.trim()}:scope:${language}:${market}${researchLanguageReference}`,
        language,
        market,
        researchLanguage,
        crossLanguageResearch,
        sourceQuality: input.sourceQuality,
        evidenceConfidence: input.evidenceConfidence,
        role: input.role ?? ContentOpportunityEvidenceRole.Supporting,
        explanation: input.explanation ?? `Web evidence from "${input.url.trim()}" is available as content evidence.`,
        observedAt: input.observedAt,
      });
      return result(WebEvidenceNormalizationStatus.Normalized, "Web evidence was normalized.", evidence);
    } catch (error) {
      return result(
        WebEvidenceNormalizationStatus.Invalid,
        error instanceof Error ? error.message : "Web evidence is invalid.",
      );
    }
  }

  normalizeMany(
    inputs: readonly (WebEvidenceInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly WebEvidenceNormalization[] {
    return Object.freeze(inputs.map((input) => this.normalize(input, expectedBusinessPackageId)));
  }
}
