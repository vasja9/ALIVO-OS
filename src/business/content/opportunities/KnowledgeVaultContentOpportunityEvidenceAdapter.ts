import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { KnowledgeItem } from "../../knowledge/KnowledgeItem.ts";
import { KnowledgeStatus } from "../../knowledge/KnowledgeStatus.ts";
import type { ContentOpportunityEvidenceAdapter } from "./ContentOpportunityEvidenceAdapter.ts";
import { canonicalLanguage, canonicalMarket } from "./LanguageMarketPolicy.ts";
import {
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";

export enum KnowledgeVaultEvidenceNormalizationStatus {
  Normalized = "Normalized",
  Missing = "Missing",
  Invalid = "Invalid",
}

export interface KnowledgeVaultEvidenceInput {
  readonly businessPackageId: BusinessPackageId;
  readonly item?: KnowledgeItem;
  readonly market: string;
  readonly role?: ContentOpportunityEvidenceRole;
  readonly explanation?: string;
  readonly observedAt?: Date;
}

export interface KnowledgeVaultEvidenceNormalization {
  readonly status: KnowledgeVaultEvidenceNormalizationStatus;
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

const result = (
  status: KnowledgeVaultEvidenceNormalizationStatus,
  reason: string,
  evidence?: ContentOpportunityEvidenceReference,
): KnowledgeVaultEvidenceNormalization => Object.freeze({ status, reason, evidence });

export class KnowledgeVaultContentOpportunityEvidenceAdapter
  implements ContentOpportunityEvidenceAdapter<KnowledgeVaultEvidenceInput, KnowledgeVaultEvidenceNormalization>
{
  normalize(
    input: KnowledgeVaultEvidenceInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): KnowledgeVaultEvidenceNormalization {
    if (!(expectedBusinessPackageId instanceof BusinessPackageId)) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Target Business Package is invalid.");
    }
    if (input === undefined || input === null) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Missing, "Knowledge Vault evidence is missing.");
    }
    if (typeof input !== "object") {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence input is invalid.");
    }
    if (!(input.businessPackageId instanceof BusinessPackageId)) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence Business Package is invalid.");
    }
    if (input.businessPackageId.value !== expectedBusinessPackageId.value) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence crosses a Business Package boundary.");
    }
    if (input.item === undefined || input.item === null) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Missing, "Knowledge Vault evidence item is missing.");
    }
    if (!(input.item instanceof KnowledgeItem)) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence item is invalid.");
    }
    if (input.item.status !== KnowledgeStatus.Approved) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, `Knowledge Vault item status "${input.item.status}" is not Approved; only Approved items may be used as evidence.`);
    }
    if (typeof input.market !== "string" || input.market.trim().length === 0) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence market is required.");
    }
    const itemLanguage = input.item.language;
    if (itemLanguage === undefined) {
      return result(KnowledgeVaultEvidenceNormalizationStatus.Invalid, "Knowledge Vault evidence language is required.");
    }

    try {
      const item = input.item;
      const language = canonicalLanguage(itemLanguage, "Knowledge Vault evidence language");
      const market = canonicalMarket(input.market, "Knowledge Vault evidence market");
      const observedAt = input.observedAt ?? item.approvedAt ?? item.validatedAt ?? item.createdAt;
      const evidence = new ContentOpportunityEvidenceReference({
        businessPackageId: expectedBusinessPackageId,
        source: ContentOpportunityEvidenceSource.KnowledgeVault,
        sourceReference: `knowledge-vault:${expectedBusinessPackageId.value}:source:${item.source}:scope:${language}:${market}`,
        evidenceReference: `knowledge-vault:${expectedBusinessPackageId.value}:item:${item.id.value}:scope:${language}:${market}`,
        language,
        market,
        role: input.role ?? ContentOpportunityEvidenceRole.Supporting,
        explanation: input.explanation ?? `Approved Knowledge Vault item "${item.title}" is available as content evidence.`,
        observedAt,
      });
      return result(KnowledgeVaultEvidenceNormalizationStatus.Normalized, "Knowledge Vault evidence was normalized.", evidence);
    } catch (error) {
      return result(
        KnowledgeVaultEvidenceNormalizationStatus.Invalid,
        error instanceof Error ? error.message : "Knowledge Vault evidence is invalid.",
      );
    }
  }

  normalizeMany(
    inputs: readonly (KnowledgeVaultEvidenceInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly KnowledgeVaultEvidenceNormalization[] {
    return Object.freeze(inputs.map((input) => this.normalize(input, expectedBusinessPackageId)));
  }
}