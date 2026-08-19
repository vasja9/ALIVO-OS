import { BusinessPackageId, Confidence } from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import {
  BusinessPackageLanguageMarketPolicy,
  ContentOpportunityLanguageMarketPolicyResolver,
  ResolvedContentOpportunityLanguageMarketPolicy,
  canonicalLanguage,
  canonicalMarket,
} from "./LanguageMarketPolicy.ts";
import type { ContentOpportunityLanguageMarketResolutionOptions } from "./LanguageMarketPolicy.ts";

export const CONTENT_OPPORTUNITY_INVALID_CODE = "CONTENT_OPPORTUNITY_INVALID" as const;
export const CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE = "CONTENT_OPPORTUNITY_BATCH_VIOLATIONS" as const;

export class ContentOpportunityIntelligenceException extends Error {
  readonly violations: readonly ContentOpportunityBatchViolation[];

  constructor(
    message: string,
    readonly code: typeof CONTENT_OPPORTUNITY_INVALID_CODE | typeof CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE = CONTENT_OPPORTUNITY_INVALID_CODE,
    violations: readonly ContentOpportunityBatchViolation[] = [],
  ) {
    super(message);
    this.name = "ContentOpportunityIntelligenceException";
    this.violations = Object.freeze([...violations]);
  }
}

const required = (value: string, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContentOpportunityIntelligenceException(`${field} must not be empty`);
  }
  return value;
};

const validDate = (value: Date, field: string): number => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ContentOpportunityIntelligenceException(`${field} must be a valid date`);
  }
  return value.getTime();
};

const frozenList = <T>(values: readonly T[]): readonly T[] => Object.freeze([...values]);

export class ContentOpportunityId {
  readonly #value: string;

  constructor(value: string) {
    this.#value = required(value, "Content opportunity identifier");
    Object.freeze(this);
  }

  get value(): string {
    return this.#value;
  }

  equals(other: ContentOpportunityId): boolean {
    return other instanceof ContentOpportunityId && other.value === this.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

export enum ContentOpportunityTarget {
  Blog = "Blog",
  Pin = "Pin",
}

export enum ContentOpportunityStatus {
  Candidate = "Candidate",
  Evaluated = "Evaluated",
  Qualified = "Qualified",
  ResearchRequired = "ResearchRequired",
  Rejected = "Rejected",
  Deferred = "Deferred",
}

export enum ContentOpportunityDestinationType {
  ContentReference = "ContentReference",
  Book = "Book",
  LandingPage = "LandingPage",
  Product = "Product",
  Url = "Url",
  Other = "Other",
}

export class ContentOpportunityDestination {
  constructor(
    readonly type: ContentOpportunityDestinationType,
    readonly reference: string,
  ) {
    required(reference, "Destination reference");
    if (!Object.values(ContentOpportunityDestinationType).includes(type)) {
      throw new ContentOpportunityIntelligenceException("Destination type is invalid");
    }
    Object.freeze(this);
  }
}

export enum ContentOpportunityEvidenceSource {
  KnowledgeVault = "KnowledgeVault",
  ExistingBlog = "ExistingBlog",
  PinterestPerformance = "PinterestPerformance",
  Web = "Web",
  Other = "Other",
}

export enum ContentOpportunityEvidenceRole {
  Supporting = "Supporting",
  Contradicting = "Contradicting",
  Neutral = "Neutral",
}

export interface ContentOpportunityEvidenceReferenceProperties {
  businessPackageId: BusinessPackageId;
  source: ContentOpportunityEvidenceSource;
  sourceReference: string;
  evidenceReference: string;
  language: string;
  market: string;
  researchLanguage?: string;
  crossLanguageResearch?: boolean;
  sourceQuality?: string;
  evidenceConfidence?: string;
  role?: ContentOpportunityEvidenceRole;
  explanation?: string;
  observedAt?: Date;
}

export class ContentOpportunityEvidenceReference {
  readonly properties: ContentOpportunityEvidenceReferenceProperties;
  readonly #observedAt?: number;

  constructor(properties: ContentOpportunityEvidenceReferenceProperties) {
    if (!(properties.businessPackageId instanceof BusinessPackageId)) {
      throw new ContentOpportunityIntelligenceException("Evidence Business Package is required");
    }
    if (!Object.values(ContentOpportunityEvidenceSource).includes(properties.source)) {
      throw new ContentOpportunityIntelligenceException("Evidence source is invalid");
    }
    if (!Object.values(ContentOpportunityEvidenceRole).includes(properties.role ?? ContentOpportunityEvidenceRole.Supporting)) {
      throw new ContentOpportunityIntelligenceException("Evidence role is invalid");
    }
    required(properties.sourceReference, "Evidence source reference");
    required(properties.evidenceReference, "Evidence reference");
    const language = canonicalLanguage(properties.language, "Evidence language");
    const market = canonicalMarket(properties.market, "Evidence market");
    const researchLanguage = properties.researchLanguage === undefined
      ? undefined
      : canonicalLanguage(properties.researchLanguage, "Evidence research language");
    const crossLanguageResearch = properties.crossLanguageResearch ?? false;
    if (crossLanguageResearch && researchLanguage === undefined) {
      throw new ContentOpportunityIntelligenceException("Cross-language research evidence requires a research language");
    }
    if (crossLanguageResearch && researchLanguage === language) {
      throw new ContentOpportunityIntelligenceException("Cross-language research evidence must use a different research language");
    }
    if (!crossLanguageResearch && researchLanguage !== undefined && researchLanguage !== language) {
      throw new ContentOpportunityIntelligenceException("A different research language must be explicitly marked as cross-language research");
    }
    if (properties.sourceQuality !== undefined) required(properties.sourceQuality, "Evidence source quality");
    if (properties.evidenceConfidence !== undefined) required(properties.evidenceConfidence, "Evidence confidence");
    if (properties.explanation !== undefined) required(properties.explanation, "Evidence explanation");
    this.#observedAt = properties.observedAt === undefined ? undefined : validDate(properties.observedAt, "Evidence observed timestamp");
    this.properties = Object.freeze({
      ...properties,
      language,
      market,
      researchLanguage,
      crossLanguageResearch,
      role: properties.role ?? ContentOpportunityEvidenceRole.Supporting,
      observedAt: this.#observedAt === undefined ? undefined : new Date(this.#observedAt),
    });
    Object.freeze(this);
  }

  get businessPackageId(): BusinessPackageId {
    return this.properties.businessPackageId;
  }

  get source(): ContentOpportunityEvidenceSource {
    return this.properties.source;
  }

  get sourceReference(): string {
    return this.properties.sourceReference;
  }

  get evidenceReference(): string {
    return this.properties.evidenceReference;
  }

  get language(): string {
    return this.properties.language;
  }

  get market(): string {
    return this.properties.market;
  }

  get researchLanguage(): string | undefined {
    return this.properties.researchLanguage;
  }

  get crossLanguageResearch(): boolean {
    return this.properties.crossLanguageResearch ?? false;
  }

  get sourceQuality(): string | undefined {
    return this.properties.sourceQuality;
  }

  get evidenceConfidence(): string | undefined {
    return this.properties.evidenceConfidence;
  }

  get role(): ContentOpportunityEvidenceRole {
    return this.properties.role ?? ContentOpportunityEvidenceRole.Supporting;
  }

  get explanation(): string | undefined {
    return this.properties.explanation;
  }

  get observedAt(): Date | undefined {
    return this.#observedAt === undefined ? undefined : new Date(this.#observedAt);
  }
}

export interface ContentOpportunityCandidateProperties {
  id: ContentOpportunityId;
  businessPackageId: BusinessPackageId;
  target: ContentOpportunityTarget;
  topic: string;
  language: string;
  market: string;
  destination: ContentOpportunityDestination;
  contentReference: string;
  evidenceReferences?: readonly ContentOpportunityEvidenceReference[];
  status?: ContentOpportunityStatus;
  createdAt: Date;
}

// Module-private construction key — only static factory methods on ContentOpportunityCandidate
// can supply this token, preventing direct ad-hoc construction with arbitrary language/market values.
const _candidateConstructionKey = Symbol("ContentOpportunityCandidate");

export class ContentOpportunityCandidate {
  readonly properties: ContentOpportunityCandidateProperties;
  readonly evidenceReferences: readonly ContentOpportunityEvidenceReference[];
  readonly #createdAt: number;

  constructor(key: symbol, properties: ContentOpportunityCandidateProperties) {
    if (key !== _candidateConstructionKey) {
      throw new ContentOpportunityIntelligenceException(
        "ContentOpportunityCandidate must be created through ContentOpportunityCandidate.fromPolicy, ContentOpportunityCandidate.fromResolvedPolicy, ContentOpportunityCandidateFactory.fromPolicy, or ContentOpportunityCandidateFactory.fromResolvedPolicy",
      );
    }
    if (!(properties.id instanceof ContentOpportunityId)) {
      throw new ContentOpportunityIntelligenceException("Content opportunity identifier is invalid");
    }
    if (!(properties.businessPackageId instanceof BusinessPackageId)) {
      throw new ContentOpportunityIntelligenceException("Business Package is required");
    }
    if (!Object.values(ContentOpportunityTarget).includes(properties.target)) {
      throw new ContentOpportunityIntelligenceException("Content opportunity target is invalid");
    }
    if (!Object.values(ContentOpportunityStatus).includes(properties.status ?? ContentOpportunityStatus.Candidate)) {
      throw new ContentOpportunityIntelligenceException("Content opportunity status is invalid");
    }
    required(properties.topic, "Opportunity topic");
    const language = canonicalLanguage(properties.language, "Opportunity language");
    const market = canonicalMarket(properties.market, "Opportunity market");
    required(properties.contentReference, "Content reference");
    this.#createdAt = validDate(properties.createdAt, "Creation timestamp");
    this.evidenceReferences = frozenList(properties.evidenceReferences ?? []);
    this.properties = Object.freeze({
      ...properties,
      language,
      market,
      evidenceReferences: this.evidenceReferences,
      status: properties.status ?? ContentOpportunityStatus.Candidate,
      createdAt: new Date(this.#createdAt),
    });
    Object.freeze(this);
  }

  /** Create a candidate whose language and market are resolved from a BusinessPackageLanguageMarketPolicy. */
  static fromPolicy(
    policy: BusinessPackageLanguageMarketPolicy,
    candidateProperties: ContentOpportunityCandidateFromPolicyProperties,
    options: ContentOpportunityLanguageMarketResolutionOptions = {},
  ): ContentOpportunityCandidate {
    if (!(policy instanceof BusinessPackageLanguageMarketPolicy)) {
      throw new ContentOpportunityIntelligenceException("Business Package language and market policy is required");
    }
    const resolved = new ContentOpportunityLanguageMarketPolicyResolver().resolve(policy, options);
    return new ContentOpportunityCandidate(_candidateConstructionKey, {
      ...candidateProperties,
      businessPackageId: resolved.businessPackageId,
      language: resolved.contentWriteLanguage,
      market: resolved.targetMarket,
    });
  }

  /**
   * Create a candidate whose language, market, and businessPackageId are stamped directly from an
   * already-resolved policy. Callers that create many candidates from the same policy can resolve
   * once and call this method in a loop, avoiding redundant resolution overhead.
   */
  static fromResolvedPolicy(
    resolved: ResolvedContentOpportunityLanguageMarketPolicy,
    candidateProperties: ContentOpportunityCandidateFromPolicyProperties,
  ): ContentOpportunityCandidate {
    if (!(resolved instanceof ResolvedContentOpportunityLanguageMarketPolicy)) {
      throw new ContentOpportunityIntelligenceException("Resolved language and market policy is required");
    }
    return new ContentOpportunityCandidate(_candidateConstructionKey, {
      ...candidateProperties,
      businessPackageId: resolved.businessPackageId,
      language: resolved.contentWriteLanguage,
      market: resolved.targetMarket,
    });
  }

  get id(): ContentOpportunityId {
    return this.properties.id;
  }

  get businessPackageId(): BusinessPackageId {
    return this.properties.businessPackageId;
  }

  get target(): ContentOpportunityTarget {
    return this.properties.target;
  }

  get topic(): string {
    return this.properties.topic;
  }

  get language(): string {
    return this.properties.language;
  }

  get market(): string {
    return this.properties.market;
  }

  get destination(): ContentOpportunityDestination {
    return this.properties.destination;
  }

  get contentReference(): string {
    return this.properties.contentReference;
  }

  get status(): ContentOpportunityStatus {
    return this.properties.status ?? ContentOpportunityStatus.Candidate;
  }

  get createdAt(): Date {
    return new Date(this.#createdAt);
  }
}

export interface ContentOpportunityCandidateFromPolicyProperties {
  id: ContentOpportunityId;
  target: ContentOpportunityTarget;
  topic: string;
  destination: ContentOpportunityDestination;
  contentReference: string;
  evidenceReferences?: readonly ContentOpportunityEvidenceReference[];
  status?: ContentOpportunityStatus;
  createdAt: Date;
}

/** Convenience wrapper around ContentOpportunityCandidate.fromPolicy for callers that prefer dependency injection. */
export class ContentOpportunityCandidateFactory {
  fromPolicy(
    policy: BusinessPackageLanguageMarketPolicy,
    candidateProperties: ContentOpportunityCandidateFromPolicyProperties,
    options: ContentOpportunityLanguageMarketResolutionOptions = {},
  ): ContentOpportunityCandidate {
    return ContentOpportunityCandidate.fromPolicy(policy, candidateProperties, options);
  }

  /**
   * Stamp language, market, and businessPackageId from an already-resolved policy.
   * Prefer this over {@link fromPolicy} when creating many candidates from the same policy:
   * resolve once with {@link ContentOpportunityLanguageMarketPolicyResolver}, then call this in a loop.
   */
  fromResolvedPolicy(
    resolved: ResolvedContentOpportunityLanguageMarketPolicy,
    candidateProperties: ContentOpportunityCandidateFromPolicyProperties,
  ): ContentOpportunityCandidate {
    return ContentOpportunityCandidate.fromResolvedPolicy(resolved, candidateProperties);
  }
}

export interface ContentOpportunityEvaluationFactorProperties {
  id: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  explanation: string;
}

export class ContentOpportunityEvaluationFactor {
  constructor(readonly properties: ContentOpportunityEvaluationFactorProperties) {
    required(properties.id, "Evaluation factor identifier");
    required(properties.label, "Evaluation factor label");
    required(properties.explanation, "Evaluation factor explanation");
    for (const [value, field] of [[properties.score, "Factor score"], [properties.weight, "Factor weight"]] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new ContentOpportunityIntelligenceException(`${field} must be between 0 and 1`);
      }
    }
    if (!Number.isFinite(properties.contribution)) {
      throw new ContentOpportunityIntelligenceException("Factor contribution must be finite");
    }
    Object.freeze(properties);
    Object.freeze(this);
  }

  get id(): string {
    return this.properties.id;
  }

  get score(): number {
    return this.properties.score;
  }

  get weight(): number {
    return this.properties.weight;
  }

  get contribution(): number {
    return this.properties.contribution;
  }
}

export interface ContentOpportunityCrossPackageViolationProperties {
  candidateId: ContentOpportunityId;
  sourceReference: string;
  evidencePackageId: BusinessPackageId;
  candidatePackageId: BusinessPackageId;
}

export interface ContentOpportunityCrossScopeViolationProperties {
  candidateId: ContentOpportunityId;
  sourceReference: string;
  evidenceLanguage: string;
  evidenceMarket: string;
  candidateLanguage: string;
  candidateMarket: string;
}

export class ContentOpportunityCrossScopeViolation {
  readonly kind = "cross-scope" as const;
  readonly properties: ContentOpportunityCrossScopeViolationProperties;

  constructor(properties: ContentOpportunityCrossScopeViolationProperties) {
    if (!(properties.candidateId instanceof ContentOpportunityId)) {
      throw new ContentOpportunityIntelligenceException("Violation candidate identifier is invalid");
    }
    required(properties.sourceReference, "Violation source reference");
    required(properties.evidenceLanguage, "Violation evidence language");
    required(properties.evidenceMarket, "Violation evidence market");
    required(properties.candidateLanguage, "Violation candidate language");
    required(properties.candidateMarket, "Violation candidate market");
    this.properties = Object.freeze({ ...properties });
    Object.freeze(this);
  }

  get candidateId(): ContentOpportunityId {
    return this.properties.candidateId;
  }

  get sourceReference(): string {
    return this.properties.sourceReference;
  }

  get evidenceLanguage(): string {
    return this.properties.evidenceLanguage;
  }

  get evidenceMarket(): string {
    return this.properties.evidenceMarket;
  }

  get candidateLanguage(): string {
    return this.properties.candidateLanguage;
  }

  get candidateMarket(): string {
    return this.properties.candidateMarket;
  }

  get detail(): string {
    return `Candidate "${this.properties.candidateId.value}": evidence reference "${this.properties.sourceReference}" belongs to language/market "${this.properties.evidenceLanguage}/${this.properties.evidenceMarket}" but candidate is scoped to "${this.properties.candidateLanguage}/${this.properties.candidateMarket}"`;
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      candidateId: this.properties.candidateId.value,
      sourceReference: this.properties.sourceReference,
      evidenceLanguage: this.properties.evidenceLanguage,
      evidenceMarket: this.properties.evidenceMarket,
      candidateLanguage: this.properties.candidateLanguage,
      candidateMarket: this.properties.candidateMarket,
      detail: this.detail,
    };
  }
}

export class ContentOpportunityCrossPackageViolation {
  readonly kind = "cross-package" as const;
  readonly properties: ContentOpportunityCrossPackageViolationProperties;

  constructor(properties: ContentOpportunityCrossPackageViolationProperties) {
    if (!(properties.candidateId instanceof ContentOpportunityId)) {
      throw new ContentOpportunityIntelligenceException("Violation candidate identifier is invalid");
    }
    if (!(properties.evidencePackageId instanceof BusinessPackageId)) {
      throw new ContentOpportunityIntelligenceException("Violation evidence Business Package is required");
    }
    if (!(properties.candidatePackageId instanceof BusinessPackageId)) {
      throw new ContentOpportunityIntelligenceException("Violation candidate Business Package is required");
    }
    required(properties.sourceReference, "Violation source reference");
    this.properties = Object.freeze({ ...properties });
    Object.freeze(this);
  }

  get candidateId(): ContentOpportunityId {
    return this.properties.candidateId;
  }

  get sourceReference(): string {
    return this.properties.sourceReference;
  }

  get evidencePackageId(): BusinessPackageId {
    return this.properties.evidencePackageId;
  }

  get candidatePackageId(): BusinessPackageId {
    return this.properties.candidatePackageId;
  }

  get detail(): string {
    return `Candidate "${this.properties.candidateId.value}": evidence reference "${this.properties.sourceReference}" belongs to Business Package "${this.properties.evidencePackageId.value}" but candidate belongs to "${this.properties.candidatePackageId.value}"`;
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      candidateId: this.properties.candidateId.value,
      sourceReference: this.properties.sourceReference,
      evidencePackageId: this.properties.evidencePackageId.value,
      candidatePackageId: this.properties.candidatePackageId.value,
      detail: this.detail,
    };
  }
}

/** Discriminated union — narrow by `violation.kind` (`"cross-package"` | `"cross-scope"`). */
export type ContentOpportunityBatchViolation =
  | ContentOpportunityCrossPackageViolation
  | ContentOpportunityCrossScopeViolation;

export class ContentOpportunityBatchEvaluationResult {
  readonly evaluations: readonly ContentOpportunityEvaluation[];
  readonly violations: readonly ContentOpportunityBatchViolation[];

  constructor(
    evaluations: readonly ContentOpportunityEvaluation[],
    violations: readonly ContentOpportunityBatchViolation[],
  ) {
    this.evaluations = frozenList(evaluations);
    this.violations = frozenList(violations);
    Object.freeze(this);
  }

  get hasViolations(): boolean {
    return this.violations.length > 0;
  }

  /**
   * Throws a {@link ContentOpportunityIntelligenceException} listing every violation when the
   * result contains one or more violations. Callers that want all-or-nothing batch semantics can
   * call this instead of checking {@link hasViolations} and constructing their own error message.
   * The method is a no-op when violations is empty.
   */
  throwIfViolations(): void {
    if (this.violations.length === 0) return;
    const summary = this.violations.map((v, i) => `  ${i + 1}. ${v.detail}`).join("\n");
    throw new ContentOpportunityIntelligenceException(
      `Batch evaluation produced ${this.violations.length} violation${this.violations.length === 1 ? "" : "s"}:\n${summary}`,
      CONTENT_OPPORTUNITY_BATCH_VIOLATIONS_CODE,
      this.violations,
    );
  }
}

export interface ContentOpportunityEvaluationProperties {
  candidateId: ContentOpportunityId;
  businessPackageId: BusinessPackageId;
  status: ContentOpportunityStatus;
  score: number;
  confidence: Confidence;
  factors: readonly ContentOpportunityEvaluationFactor[];
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  evaluatedAt: Date;
  explanation: string;
}

export class ContentOpportunityEvaluation {
  readonly properties: ContentOpportunityEvaluationProperties;
  readonly factors: readonly ContentOpportunityEvaluationFactor[];
  readonly #evaluatedAt: number;

  constructor(properties: ContentOpportunityEvaluationProperties) {
    if (!(properties.candidateId instanceof ContentOpportunityId)) {
      throw new ContentOpportunityIntelligenceException("Evaluation candidate identifier is invalid");
    }
    if (!(properties.businessPackageId instanceof BusinessPackageId)) {
      throw new ContentOpportunityIntelligenceException("Evaluation Business Package is required");
    }
    if (!Object.values(ContentOpportunityStatus).includes(properties.status)) {
      throw new ContentOpportunityIntelligenceException("Evaluation status is invalid");
    }
    if (!Number.isFinite(properties.score) || properties.score < 0 || properties.score > 1) {
      throw new ContentOpportunityIntelligenceException("Evaluation score must be between 0 and 1");
    }
    if (!Number.isInteger(properties.supportingEvidenceCount) || properties.supportingEvidenceCount < 0) {
      throw new ContentOpportunityIntelligenceException("Supporting evidence count is invalid");
    }
    if (!Number.isInteger(properties.contradictingEvidenceCount) || properties.contradictingEvidenceCount < 0) {
      throw new ContentOpportunityIntelligenceException("Contradicting evidence count is invalid");
    }
    required(properties.explanation, "Evaluation explanation");
    this.#evaluatedAt = validDate(properties.evaluatedAt, "Evaluation timestamp");
    this.factors = frozenList(properties.factors);
    this.properties = Object.freeze({
      ...properties,
      factors: this.factors,
      evaluatedAt: new Date(this.#evaluatedAt),
    });
    Object.freeze(this);
  }

  get candidateId(): ContentOpportunityId {
    return this.properties.candidateId;
  }

  get businessPackageId(): BusinessPackageId {
    return this.properties.businessPackageId;
  }

  get status(): ContentOpportunityStatus {
    return this.properties.status;
  }

  get score(): number {
    return this.properties.score;
  }

  get confidence(): Confidence {
    return this.properties.confidence;
  }

  get supportingEvidenceCount(): number {
    return this.properties.supportingEvidenceCount;
  }

  get contradictingEvidenceCount(): number {
    return this.properties.contradictingEvidenceCount;
  }

  get explanation(): string {
    return this.properties.explanation;
  }

  get evaluatedAt(): Date {
    return new Date(this.#evaluatedAt);
  }
}