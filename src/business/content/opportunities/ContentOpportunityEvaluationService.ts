import { Confidence } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import {
  ContentOpportunityBatchEvaluationResult,
  ContentOpportunityCandidate,
  ContentOpportunityCrossPackageViolation,
  ContentOpportunityCrossScopeViolation,
  ContentOpportunityEvaluation,
  ContentOpportunityEvaluationFactor,
  ContentOpportunityEvidenceRole,
  ContentOpportunityIntelligenceException,
  ContentOpportunityStatus,
} from "./ContentOpportunityIntelligenceDomain.ts";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/** Minimum aggregate score (inclusive) required for a candidate to reach Qualified status. */
export const QUALIFIED_SCORE_THRESHOLD = 0.75;

export class ContentOpportunityEvaluationService {
  evaluate(candidate: ContentOpportunityCandidate, evaluatedAt: Date): ContentOpportunityEvaluation {
    if (evaluatedAt.getTime() < candidate.createdAt.getTime()) {
      throw new ContentOpportunityIntelligenceException("Evaluation cannot precede candidate creation");
    }

    const crossPackage = candidate.evidenceReferences.find(
      (reference) => reference.businessPackageId.value !== candidate.businessPackageId.value,
    );
    if (crossPackage !== undefined) {
      throw new ContentOpportunityIntelligenceException(
        `Evidence reference "${crossPackage.sourceReference}" belongs to Business Package "${crossPackage.businessPackageId.value}" but candidate belongs to "${candidate.businessPackageId.value}"`,
      );
    }
    const crossScope = candidate.evidenceReferences.find(
      (reference) => reference.language !== candidate.language || reference.market !== candidate.market,
    );
    if (crossScope !== undefined) {
      throw new ContentOpportunityIntelligenceException(
        `Evidence reference "${crossScope.sourceReference}" belongs to language/market "${crossScope.language}/${crossScope.market}" but candidate is scoped to "${candidate.language}/${candidate.market}"`,
      );
    }

    const supporting = candidate.evidenceReferences.filter((reference) => reference.role === ContentOpportunityEvidenceRole.Supporting);
    const contradicting = candidate.evidenceReferences.filter((reference) => reference.role === ContentOpportunityEvidenceRole.Contradicting);
    const sourceDiversity = new Set(candidate.evidenceReferences.map((reference) => reference.source)).size;
    const evidenceCoverage = clamp(supporting.length / 2);
    const sourceDiversityScore = clamp(sourceDiversity / 2);
    const contradictionScore = supporting.length === 0 ? 0 : clamp(1 - contradicting.length / supporting.length);

    const factors = [
      new ContentOpportunityEvaluationFactor({
        id: "evidence-coverage",
        label: "Supporting evidence coverage",
        score: evidenceCoverage,
        weight: 0.35,
        contribution: evidenceCoverage * 0.35,
        explanation: `${supporting.length} supporting evidence reference(s) are available.`,
      }),
      new ContentOpportunityEvaluationFactor({
        id: "source-diversity",
        label: "Evidence source diversity",
        score: sourceDiversityScore,
        weight: 0.25,
        contribution: sourceDiversityScore * 0.25,
        explanation: `${sourceDiversity} distinct evidence source type(s) are represented.`,
      }),
      new ContentOpportunityEvaluationFactor({
        id: "destination-readiness",
        label: "Destination readiness",
        score: 1,
        weight: 0.2,
        contribution: 0.2,
        explanation: `Target destination ${candidate.destination.reference} is explicitly identified.`,
      }),
      new ContentOpportunityEvaluationFactor({
        id: "content-scope",
        label: "Content scope clarity",
        score: 1,
        weight: 0.1,
        contribution: 0.1,
        explanation: `${candidate.target} target is scoped to ${candidate.language}/${candidate.market} and topic "${candidate.topic}".`,
      }),
      new ContentOpportunityEvaluationFactor({
        id: "contradiction-check",
        label: "Contradiction check",
        score: contradictionScore,
        weight: 0.1,
        contribution: contradictionScore * 0.1,
        explanation: `${contradicting.length} contradicting evidence reference(s) are present.`,
      }),
    ];

    const score = Number(factors.reduce((total, factor) => total + factor.contribution, 0).toFixed(3));
    const status = this.status(candidate.status, supporting.length, contradicting.length, score);
    const explanation = this.explanation(status, supporting.length, contradicting.length, score);

    return new ContentOpportunityEvaluation({
      candidateId: candidate.id,
      businessPackageId: candidate.businessPackageId,
      status,
      score,
      confidence: new Confidence(score),
      factors,
      supportingEvidenceCount: supporting.length,
      contradictingEvidenceCount: contradicting.length,
      evaluatedAt,
      explanation,
    });
  }

  evaluateMany(candidates: readonly ContentOpportunityCandidate[], evaluatedAt: Date): ContentOpportunityBatchEvaluationResult {
    const violations: (ContentOpportunityCrossPackageViolation | ContentOpportunityCrossScopeViolation)[] = [];
    const evaluations: ContentOpportunityEvaluation[] = [];

    for (const candidate of candidates) {
      // Collect-all: emit one violation per offending cross-package reference so operators can see
      // every mismatch in a single pass rather than resubmitting after fixing one reference at a time.
      const crossPackageRefs = candidate.evidenceReferences.filter(
        (reference) => reference.businessPackageId.value !== candidate.businessPackageId.value,
      );
      for (const crossPackage of crossPackageRefs) {
        violations.push(
          new ContentOpportunityCrossPackageViolation({
            candidateId: candidate.id,
            sourceReference: crossPackage.sourceReference,
            evidencePackageId: crossPackage.businessPackageId,
            candidatePackageId: candidate.businessPackageId,
          }),
        );
      }

      // Collect-all: emit one violation per offending cross-scope reference so operators can see
      // every mismatch in a single pass rather than resubmitting after fixing one reference at a time.
      // Both violation kinds are always collected before moving on — a candidate that carries both
      // cross-package and cross-scope offenders surfaces all violation kinds in a single pass so
      // operators can correct every issue without resubmitting after fixing one violation type at a time.
      const crossScopeRefs = candidate.evidenceReferences.filter(
        (reference) => reference.language !== candidate.language || reference.market !== candidate.market,
      );
      for (const crossScope of crossScopeRefs) {
        violations.push(
          new ContentOpportunityCrossScopeViolation({
            candidateId: candidate.id,
            sourceReference: crossScope.sourceReference,
            evidenceLanguage: crossScope.language,
            evidenceMarket: crossScope.market,
            candidateLanguage: candidate.language,
            candidateMarket: candidate.market,
          }),
        );
      }

      // Skip evaluation for any candidate that produced violations of either kind.
      if (crossPackageRefs.length > 0 || crossScopeRefs.length > 0) {
        continue;
      }

      evaluations.push(this.evaluate(candidate, evaluatedAt));
    }

    return new ContentOpportunityBatchEvaluationResult(evaluations, violations);
  }

  private status(
    candidateStatus: ContentOpportunityStatus,
    supportingCount: number,
    contradictingCount: number,
    score: number,
  ): ContentOpportunityStatus {
    if (candidateStatus === ContentOpportunityStatus.Deferred) return ContentOpportunityStatus.Deferred;
    if (candidateStatus === ContentOpportunityStatus.Rejected) return ContentOpportunityStatus.Rejected;
    if (supportingCount === 0) return ContentOpportunityStatus.ResearchRequired;
    if (contradictingCount >= supportingCount) return ContentOpportunityStatus.Rejected;
    if (score >= QUALIFIED_SCORE_THRESHOLD) return ContentOpportunityStatus.Qualified;
    return ContentOpportunityStatus.Evaluated;
  }

  private explanation(
    status: ContentOpportunityStatus,
    supportingCount: number,
    contradictingCount: number,
    score: number,
  ): string {
    if (status === ContentOpportunityStatus.ResearchRequired) return "Additional supporting evidence is required before creation planning.";
    if (status === ContentOpportunityStatus.Rejected) return "Contradicting evidence prevents this candidate from being recommended for creation.";
    if (status === ContentOpportunityStatus.Deferred) return "The candidate is deferred by the current read-only state.";
    if (status === ContentOpportunityStatus.Qualified) return `Evidence supports a qualified creation candidate with score ${score}.`;
    return `${supportingCount} supporting and ${contradictingCount} contradicting evidence reference(s) produce an evaluated candidate.`;
  }
}