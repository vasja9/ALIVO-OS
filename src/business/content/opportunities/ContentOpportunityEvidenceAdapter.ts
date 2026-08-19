import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { ContentOpportunityEvidenceReference } from "./ContentOpportunityIntelligenceDomain.ts";

/**
 * Base shape shared by all evidence normalization results.
 *
 * When normalization succeeds, `evidence` is present and its `businessPackageId`
 * is guaranteed to equal the `expectedBusinessPackageId` that was passed to the
 * adapter — so downstream evaluation guards can trust the stamp without
 * re-verifying the source.
 *
 * When normalization fails, `evidence` is absent and `reason` describes why.
 */
export interface ContentOpportunityEvidenceNormalizationBase {
  readonly evidence?: ContentOpportunityEvidenceReference;
  readonly reason: string;
}

/**
 * Contract for all Content Opportunity evidence adapters.
 *
 * Each adapter accepts source-specific input and an `expectedBusinessPackageId`,
 * then returns a normalization result that either carries a verified
 * {@link ContentOpportunityEvidenceReference} (stamped with the expected
 * `businessPackageId`) or explains why normalization failed.
 *
 * ## Implementor obligations
 *
 * 1. **Business Package boundary check** — verify that `input.businessPackageId`
 *    equals `expectedBusinessPackageId` before producing a reference.  Evidence
 *    that crosses a Business Package boundary must be rejected with an `Invalid`
 *    status so it never reaches the evaluation guard.
 *
 * 2. **businessPackageId stamp** — pass `expectedBusinessPackageId` (not the
 *    value from raw input) to the `ContentOpportunityEvidenceReference`
 *    constructor.  This guarantees the stamp on every normalized reference is
 *    authoritative and uniform, regardless of what the source system supplies.
 *
 * Failing either obligation causes evidence to fail the evaluation guard
 * unexpectedly, which is exactly the silent failure this contract is designed
 * to prevent.
 */
export interface ContentOpportunityEvidenceAdapter<
  TInput,
  TNormalization extends ContentOpportunityEvidenceNormalizationBase,
> {
  /**
   * Normalize a single piece of source evidence against `expectedBusinessPackageId`.
   *
   * Accepts `undefined` input so callers do not need to guard before calling;
   * adapters must return a `Missing` result in that case.
   */
  normalize(
    input: TInput | undefined,
    expectedBusinessPackageId: BusinessPackageId,
  ): TNormalization;

  /**
   * Normalize a batch of source evidence items, preserving order.
   *
   * Every item is normalized independently; failures in one item do not affect
   * the others.  The returned array is frozen and parallel in index to `inputs`.
   */
  normalizeMany(
    inputs: readonly (TInput | undefined)[],
    expectedBusinessPackageId: BusinessPackageId,
  ): readonly TNormalization[];
}
