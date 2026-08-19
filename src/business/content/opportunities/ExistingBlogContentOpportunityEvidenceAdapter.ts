import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import type { ContentOpportunityEvidenceAdapter } from "./ContentOpportunityEvidenceAdapter.ts";
import { canonicalLanguage, canonicalMarket } from "./LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum ExistingBlogEvidenceStatus {
  Published = "Published",
  Approved = "Approved",
  Draft = "Draft",
  Archived = "Archived",
  Unknown = "Unknown",
}

export enum ExistingBlogEvidenceValidity {
  Current = "Current",
  Stale = "Stale",
  Invalid = "Invalid",
  Unknown = "Unknown",
}

export enum ExistingBlogEvidenceNormalizationStatus {
  Normalized = "Normalized",
  Missing = "Missing",
  Invalid = "Invalid",
}

export interface ExistingBlogEvidenceInput {
  readonly businessPackageId: BusinessPackageId;
  readonly blogReference?: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly language?: string;
  readonly market?: string;
  readonly status: ExistingBlogEvidenceStatus;
  readonly validity: ExistingBlogEvidenceValidity;
  readonly role?: ContentOpportunityEvidenceRole;
  readonly explanation?: string;
  readonly observedAt?: Date;
}

export interface ExistingBlogEvidenceNormalization {
  readonly status: ExistingBlogEvidenceNormalizationStatus;
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

const result = (
  status: ExistingBlogEvidenceNormalizationStatus,
  reason: string,
  evidence?: ContentOpportunityEvidenceReference,
): ExistingBlogEvidenceNormalization => Object.freeze({ status, reason, evidence });

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const absoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export class ExistingBlogContentOpportunityEvidenceAdapter
  implements ContentOpportunityEvidenceAdapter<ExistingBlogEvidenceInput, ExistingBlogEvidenceNormalization>
{
  normalize(
    input: ExistingBlogEvidenceInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): ExistingBlogEvidenceNormalization {
    if (!(expectedBusinessPackageId instanceof BusinessPackageId)) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Target Business Package is invalid.");
    }
    if (input === undefined || input === null) {
      return result(ExistingBlogEvidenceNormalizationStatus.Missing, "Existing Blog evidence is missing.");
    }
    if (typeof input !== "object") {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog evidence input is invalid.");
    }
    if (!(input.businessPackageId instanceof BusinessPackageId)) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog evidence Business Package is invalid.");
    }
    if (input.businessPackageId.value !== expectedBusinessPackageId.value) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog evidence crosses a Business Package boundary.");
    }
    if (!nonEmpty(input.blogReference) && !nonEmpty(input.canonicalUrl)) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog identity or canonical URL is required.");
    }
    if (!nonEmpty(input.language) || !nonEmpty(input.market)) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog language and market are required.");
    }
    if (input.canonicalUrl !== undefined && (!nonEmpty(input.canonicalUrl) || !absoluteHttpUrl(input.canonicalUrl))) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog canonical URL is invalid.");
    }
    if (![ExistingBlogEvidenceStatus.Published, ExistingBlogEvidenceStatus.Approved].includes(input.status)) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog status is not valid evidence.");
    }
    if (input.validity !== ExistingBlogEvidenceValidity.Current) {
      return result(ExistingBlogEvidenceNormalizationStatus.Invalid, "Existing Blog evidence is not current.");
    }

    try {
      const identity = input.blogReference?.trim() || input.canonicalUrl!;
      const language = canonicalLanguage(input.language, "Existing Blog evidence language");
      const market = canonicalMarket(input.market, "Existing Blog evidence market");
      const evidence = new ContentOpportunityEvidenceReference({
        businessPackageId: expectedBusinessPackageId,
        source: ContentOpportunityEvidenceSource.ExistingBlog,
        sourceReference: `existing-blog:${expectedBusinessPackageId.value}:blog:${identity}:scope:${language}:${market}`,
        evidenceReference: `${input.canonicalUrl?.trim() || `existing-blog:${expectedBusinessPackageId.value}:reference:${identity}`}:scope:${language}:${market}`,
        language,
        market,
        role: input.role ?? ContentOpportunityEvidenceRole.Supporting,
        explanation: input.explanation?.trim()
          || `Existing Blog "${input.title?.trim() || identity}" is ${input.status.toLowerCase()} for ${input.language}/${input.market}.`,
        observedAt: input.observedAt,
      });
      return result(ExistingBlogEvidenceNormalizationStatus.Normalized, "Existing Blog evidence was normalized.", evidence);
    } catch (error) {
      return result(
        ExistingBlogEvidenceNormalizationStatus.Invalid,
        error instanceof Error ? error.message : "Existing Blog evidence is invalid.",
      );
    }
  }

  normalizeMany(
    inputs: readonly (ExistingBlogEvidenceInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly ExistingBlogEvidenceNormalization[] {
    return Object.freeze(inputs.map((input) => this.normalize(input, expectedBusinessPackageId)));
  }
}