import {
  ContentOpportunityId,
  ContentOpportunityEvidenceReference,
  ContentOpportunityEvidenceRole,
  ContentOpportunityEvidenceSource,
} from "./ContentOpportunityIntelligenceDomain.ts";
import { ResolvedContentOpportunityLanguageMarketPolicy } from "./LanguageMarketPolicy.ts";

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must not be empty.`);
  }
  return value.trim();
};

const canonicalTopic = (value: string): string =>
  requiredText(value, "Opportunity topic").normalize("NFKC").replace(/\s+/g, " ").toLowerCase();

export class ContentOpportunityEvidenceIdentity {
  readonly opportunityId: ContentOpportunityId;
  readonly topic: string;

  constructor(opportunityId: ContentOpportunityId, topic: string) {
    if (!(opportunityId instanceof ContentOpportunityId)) {
      throw new Error("Opportunity identity is invalid.");
    }
    this.opportunityId = opportunityId;
    this.topic = canonicalTopic(topic);
    Object.freeze(this);
  }
}

export class ContentOpportunityScopedEvidence {
  readonly identity: ContentOpportunityEvidenceIdentity;
  readonly evidence: ContentOpportunityEvidenceReference;

  constructor(
    identity: ContentOpportunityEvidenceIdentity,
    evidence: ContentOpportunityEvidenceReference,
  ) {
    if (!(identity instanceof ContentOpportunityEvidenceIdentity)) {
      throw new Error("Evidence opportunity identity is invalid.");
    }
    if (!(evidence instanceof ContentOpportunityEvidenceReference)) {
      throw new Error("Evidence reference is invalid.");
    }
    this.identity = identity;
    this.evidence = evidence;
    Object.freeze(this);
  }
}

export enum ContentOpportunityEvidenceAggregationStatus {
  Aggregated = "Aggregated",
  Partial = "Partial",
  Invalid = "Invalid",
}

export interface ContentOpportunityEvidenceProvenance {
  readonly opportunityId: string;
  readonly topic: string;
  readonly source: ContentOpportunityEvidenceSource;
  readonly sourceReference: string;
  readonly evidenceReference: string;
  readonly language: string;
  readonly market: string;
  readonly researchLanguage?: string;
  readonly crossLanguageResearch: boolean;
  readonly role: ContentOpportunityEvidenceRole;
  readonly observedAt?: string;
  readonly sourceQuality?: string;
  readonly evidenceConfidence?: string;
}

export interface ContentOpportunityEvidenceAggregation {
  readonly status: ContentOpportunityEvidenceAggregationStatus;
  readonly opportunityId?: ContentOpportunityId;
  readonly topic?: string;
  readonly businessPackageId?: ResolvedContentOpportunityLanguageMarketPolicy["businessPackageId"];
  readonly language?: string;
  readonly market?: string;
  readonly evidenceReferences: readonly ContentOpportunityEvidenceReference[];
  readonly provenance: readonly ContentOpportunityEvidenceProvenance[];
  readonly sourceDiversity: number;
  readonly supportingEvidenceCount: number;
  readonly contradictingEvidenceCount: number;
  readonly neutralEvidenceCount: number;
  readonly missingSources: readonly ContentOpportunityEvidenceSource[];
  readonly duplicateEvidenceCount: number;
  readonly duplicateEvidenceReferences: readonly string[];
  readonly reason: string;
}

const requiredSources: readonly ContentOpportunityEvidenceSource[] = Object.freeze([
  ContentOpportunityEvidenceSource.KnowledgeVault,
  ContentOpportunityEvidenceSource.ExistingBlog,
  ContentOpportunityEvidenceSource.PinterestPerformance,
  ContentOpportunityEvidenceSource.Web,
]);

const sourceOrder = new Map(requiredSources.map((source, index) => [source, index]));

const aggregation = (
  status: ContentOpportunityEvidenceAggregationStatus,
  reason: string,
  details: Partial<Omit<ContentOpportunityEvidenceAggregation, "status" | "reason">> = {},
): ContentOpportunityEvidenceAggregation => Object.freeze({
  status,
  reason,
  opportunityId: details.opportunityId,
  topic: details.topic,
  businessPackageId: details.businessPackageId,
  language: details.language,
  market: details.market,
  evidenceReferences: Object.freeze([...(details.evidenceReferences ?? [])]),
  provenance: Object.freeze([...(details.provenance ?? [])]),
  sourceDiversity: details.sourceDiversity ?? 0,
  supportingEvidenceCount: details.supportingEvidenceCount ?? 0,
  contradictingEvidenceCount: details.contradictingEvidenceCount ?? 0,
  neutralEvidenceCount: details.neutralEvidenceCount ?? 0,
  missingSources: Object.freeze([...(details.missingSources ?? [])]),
  duplicateEvidenceCount: details.duplicateEvidenceCount ?? 0,
  duplicateEvidenceReferences: Object.freeze([...(details.duplicateEvidenceReferences ?? [])]),
});

const provenanceOf = (scopedEvidence: ContentOpportunityScopedEvidence): ContentOpportunityEvidenceProvenance =>
  Object.freeze({
    opportunityId: scopedEvidence.identity.opportunityId.value,
    topic: scopedEvidence.identity.topic,
    source: scopedEvidence.evidence.source,
    sourceReference: scopedEvidence.evidence.sourceReference,
    evidenceReference: scopedEvidence.evidence.evidenceReference,
    language: scopedEvidence.evidence.language,
    market: scopedEvidence.evidence.market,
    researchLanguage: scopedEvidence.evidence.researchLanguage,
    crossLanguageResearch: scopedEvidence.evidence.crossLanguageResearch,
    role: scopedEvidence.evidence.role,
    observedAt: scopedEvidence.evidence.observedAt?.toISOString(),
    sourceQuality: scopedEvidence.evidence.sourceQuality,
    evidenceConfidence: scopedEvidence.evidence.evidenceConfidence,
  });

const invalidIdentityReason = (
  target: ContentOpportunityEvidenceIdentity,
  actual: ContentOpportunityEvidenceIdentity,
): string => {
  if (actual.opportunityId.value !== target.opportunityId.value) {
    return `Evidence belongs to opportunity "${actual.opportunityId.value}", expected "${target.opportunityId.value}".`;
  }
  return `Evidence belongs to topic "${actual.topic}", expected "${target.topic}".`;
};

const scopedEvidenceReferences = (
  values: readonly ContentOpportunityScopedEvidence[],
): readonly ContentOpportunityEvidenceReference[] => values.map((value) => value.evidence);

const evidenceKey = (evidence: ContentOpportunityEvidenceReference): string =>
  `${evidence.source}:${evidence.evidenceReference}`;

const isSupportedSource = (source: ContentOpportunityEvidenceSource): boolean =>
  requiredSources.includes(source);

const invalidAggregation = (reason: string): ContentOpportunityEvidenceAggregation =>
  aggregation(ContentOpportunityEvidenceAggregationStatus.Invalid, reason);

export class ContentOpportunityEvidenceAggregator {
  aggregate(
    target: ResolvedContentOpportunityLanguageMarketPolicy,
    targetIdentity: ContentOpportunityEvidenceIdentity,
    scopedEvidence: readonly ContentOpportunityScopedEvidence[],
  ): ContentOpportunityEvidenceAggregation {
    if (!(target instanceof ResolvedContentOpportunityLanguageMarketPolicy)) {
      return invalidAggregation("Evidence aggregation target policy is invalid.");
    }
    if (!(targetIdentity instanceof ContentOpportunityEvidenceIdentity)) {
      return invalidAggregation("Explicit opportunity identity is required before evidence aggregation.");
    }
    if (!Array.isArray(scopedEvidence)) {
      return invalidAggregation("Scoped evidence must be an array.");
    }

    const unique: ContentOpportunityScopedEvidence[] = [];
    const seen = new Set<string>();
    const duplicateEvidenceReferences: string[] = [];

    for (const scoped of scopedEvidence) {
      if (!(scoped instanceof ContentOpportunityScopedEvidence)) {
        return invalidAggregation("Evidence aggregation requires explicit scoped opportunity identity for every evidence reference.");
      }
      if (
        scoped.identity.opportunityId.value !== targetIdentity.opportunityId.value
        || scoped.identity.topic !== targetIdentity.topic
      ) {
        return invalidAggregation(invalidIdentityReason(targetIdentity, scoped.identity));
      }
      const evidence = scoped.evidence;
      if (!isSupportedSource(evidence.source)) {
        return invalidAggregation(`Evidence source "${evidence.source}" is not supported by the 006B-6 aggregator.`);
      }
      if (evidence.businessPackageId.value !== target.businessPackageId.value) {
        return invalidAggregation(`Evidence reference "${evidence.evidenceReference}" crosses a Business Package boundary.`);
      }
      if (evidence.language !== target.contentWriteLanguage || evidence.market !== target.targetMarket) {
        return invalidAggregation(`Evidence reference "${evidence.evidenceReference}" is scoped to ${evidence.language}/${evidence.market}, expected ${target.contentWriteLanguage}/${target.targetMarket}.`);
      }
      if (evidence.crossLanguageResearch && evidence.source !== ContentOpportunityEvidenceSource.Web) {
        return invalidAggregation("Cross-language research evidence is supported only for the Web Research source.");
      }
      if (evidence.crossLanguageResearch && (
        evidence.researchLanguage === undefined
        || evidence.researchLanguage === evidence.language
      )) {
        return invalidAggregation("Cross-language research evidence requires a distinct, explicit research language.");
      }

      const key = evidenceKey(evidence);
      if (seen.has(key)) {
        duplicateEvidenceReferences.push(key);
        continue;
      }
      seen.add(key);
      unique.push(scoped);
    }

    unique.sort((left, right) =>
      (sourceOrder.get(left.evidence.source)! - sourceOrder.get(right.evidence.source)!)
      || left.evidence.evidenceReference.localeCompare(right.evidence.evidenceReference)
      || left.evidence.sourceReference.localeCompare(right.evidence.sourceReference));

    const presentSources = new Set(unique.map((scoped) => scoped.evidence.source));
    const missingSources = requiredSources.filter((source) => !presentSources.has(source));
    const supportingEvidenceCount = unique.filter((scoped) => scoped.evidence.role === ContentOpportunityEvidenceRole.Supporting).length;
    const contradictingEvidenceCount = unique.filter((scoped) => scoped.evidence.role === ContentOpportunityEvidenceRole.Contradicting).length;
    const neutralEvidenceCount = unique.filter((scoped) => scoped.evidence.role === ContentOpportunityEvidenceRole.Neutral).length;
    const status = missingSources.length === 0
      ? ContentOpportunityEvidenceAggregationStatus.Aggregated
      : ContentOpportunityEvidenceAggregationStatus.Partial;
    const missingDescription = missingSources.length === 0
      ? "no required evidence source is missing"
      : `missing sources: ${missingSources.join(", ")}`;
    const reason = [
      `${status} evidence for ${target.contentWriteLanguage}/${target.targetMarket}`,
      `${unique.length} unique evidence reference(s) across ${presentSources.size} source(s)`,
      `opportunity "${targetIdentity.opportunityId.value}" topic "${targetIdentity.topic}"`,
      missingDescription,
      `${duplicateEvidenceReferences.length} duplicate(s) removed`,
      `roles: supporting=${supportingEvidenceCount}, contradicting=${contradictingEvidenceCount}, neutral=${neutralEvidenceCount}`,
    ].join("; ");

    return aggregation(status, reason, {
      opportunityId: targetIdentity.opportunityId,
      topic: targetIdentity.topic,
      businessPackageId: target.businessPackageId,
      language: target.contentWriteLanguage,
      market: target.targetMarket,
      evidenceReferences: scopedEvidenceReferences(unique),
      provenance: unique.map(provenanceOf),
      sourceDiversity: presentSources.size,
      supportingEvidenceCount,
      contradictingEvidenceCount,
      neutralEvidenceCount,
      missingSources,
      duplicateEvidenceCount: duplicateEvidenceReferences.length,
      duplicateEvidenceReferences,
    });
  }
}