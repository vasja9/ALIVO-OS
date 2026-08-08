import {
  BusinessPackageId, Confidence, Evidence, Freshness, MarketObservation,
  MarketSourceId, Provenance,
} from "../../../intelligence/market/MarketIntelligenceDomain.ts";
import { CompetitiveIntelligenceException } from "./CompetitiveIntelligenceException.ts";

function text(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new CompetitiveIntelligenceException(`${field} must not be empty`, "INVALID_DOMAIN_STATE");
  return value;
}
function date(value: Date, field: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new CompetitiveIntelligenceException(`${field} must be a valid date`, "INVALID_DOMAIN_STATE");
  return value.getTime();
}
function values<T>(items: readonly T[]): readonly T[] { return Object.freeze([...items]); }

abstract class Id {
  constructor(readonly value: string, field: string) { text(value, field); Object.freeze(this); }
  toString(): string { return this.value; }
}
export class CompetitiveObservationId extends Id { constructor(value: string) { super(value, "Competitive observation identifier"); } }
export class CompetitiveAnalysisId extends Id { constructor(value: string) { super(value, "Competitive analysis identifier"); } }

export enum CompetitiveSubjectType { PublicContent="PublicContent", PublicOffer="PublicOffer", PublicListing="PublicListing", PublicProductPresentation="PublicProductPresentation", PublicPage="PublicPage", PublicPost="PublicPost", PublicMarketplaceEntry="PublicMarketplaceEntry", OtherPublicArtefact="OtherPublicArtefact" }
export class CompetitiveSubject {
  constructor(readonly id: string, readonly type: CompetitiveSubjectType, readonly label: string) {
    text(id, "Subject identifier"); text(label, "Subject label");
    if (!Object.values(CompetitiveSubjectType).includes(type)) throw new CompetitiveIntelligenceException("Subject type is invalid", "INVALID_SUBJECT");
    Object.freeze(this);
  }
}

export class CompetitiveObservation {
  readonly evidence: readonly Evidence[];
  constructor(readonly id: CompetitiveObservationId, readonly marketObservation: MarketObservation, readonly subject: CompetitiveSubject,
    readonly contentType: string, readonly analysisScope: string, readonly businessPackageId: BusinessPackageId | undefined, evidence: readonly Evidence[]) {
    text(contentType, "Observed content type"); text(analysisScope, "Analysis scope");
    if (marketObservation.businessPackageId?.value !== businessPackageId?.value) throw new CompetitiveIntelligenceException("Competitive observation must retain its MarketObservation Business Package", "PACKAGE_MISMATCH");
    for (const item of evidence) if (!item.observationIds.some((candidate) => candidate.value === marketObservation.id.value)) throw new CompetitiveIntelligenceException("Evidence must reference the MarketObservation", "INVALID_EVIDENCE");
    this.evidence = values(evidence); Object.freeze(this);
  }
}

export interface ContentProfileProperties { title?: string; headline?: string; description?: string; contentLength?: number; contentStructure?: string; informationHierarchy?: string; callToAction?: string; publicationTimestamp?: Date; freshness?: Freshness; language?: string; audienceCues?: string; problemSolvingApproach?: string; }
export class CompetitiveContentProfile {
  readonly #published?: number;
  readonly title?: string; readonly headline?: string; readonly description?: string; readonly contentLength?: number; readonly contentStructure?: string; readonly informationHierarchy?: string; readonly callToAction?: string; readonly freshness?: Freshness; readonly language?: string; readonly audienceCues?: string; readonly problemSolvingApproach?: string;
  constructor(properties: ContentProfileProperties = {}) {
    if (properties.contentLength !== undefined && (!Number.isInteger(properties.contentLength) || properties.contentLength < 0)) throw new CompetitiveIntelligenceException("Content length must be a non-negative integer", "INVALID_CONTENT_PROFILE");
    const { publicationTimestamp, ...observable } = properties;
    Object.assign(this, observable); this.#published = publicationTimestamp === undefined ? undefined : date(publicationTimestamp, "Publication timestamp"); Object.freeze(this);
  }
  get publicationTimestamp(): Date | undefined { return this.#published === undefined ? undefined : new Date(this.#published); }
}

export interface KeywordAnalysisProperties { keywords?: readonly string[]; keywordPhrases?: readonly string[]; titleKeywordUsage?: readonly string[]; descriptionKeywordUsage?: readonly string[]; repeatedTerminology?: readonly string[]; topicTerms?: readonly string[]; queryAlignedTerms?: readonly string[]; evidence: readonly Evidence[]; }
export class KeywordAnalysis {
  readonly keywords: readonly string[]; readonly keywordPhrases: readonly string[]; readonly titleKeywordUsage: readonly string[]; readonly descriptionKeywordUsage: readonly string[]; readonly repeatedTerminology: readonly string[]; readonly topicTerms: readonly string[]; readonly queryAlignedTerms: readonly string[]; readonly evidence: readonly Evidence[];
  constructor(p: KeywordAnalysisProperties) { this.keywords=values(p.keywords??[]); this.keywordPhrases=values(p.keywordPhrases??[]); this.titleKeywordUsage=values(p.titleKeywordUsage??[]); this.descriptionKeywordUsage=values(p.descriptionKeywordUsage??[]); this.repeatedTerminology=values(p.repeatedTerminology??[]); this.topicTerms=values(p.topicTerms??[]); this.queryAlignedTerms=values(p.queryAlignedTerms??[]); this.evidence=values(p.evidence); Object.freeze(this); }
}

export enum SearchIntent { Informational="Informational", Navigational="Navigational", Commercial="Commercial", Transactional="Transactional", Comparative="Comparative", ProblemSolving="ProblemSolving", Inspirational="Inspirational", Unknown="Unknown" }
export class SearchIntentAnalysis {
  readonly intent: SearchIntent; readonly evidence: readonly Evidence[];
  constructor(intent: SearchIntent, evidence: readonly Evidence[], readonly confidence: Confidence, readonly rationale: string) {
    text(rationale, "Search-intent rationale"); this.evidence=values(evidence); this.intent=evidence.length === 0 ? SearchIntent.Unknown : intent;
    if (!Object.values(SearchIntent).includes(this.intent)) throw new CompetitiveIntelligenceException("Search intent is invalid", "INVALID_SEARCH_INTENT"); Object.freeze(this);
  }
}

export interface VisualAnalysisProperties { imagePresence?: boolean; imageType?: string; visualComposition?: string; graphicStyle?: string; colourCharacteristics?: string; typographyCharacteristics?: string; layoutCharacteristics?: string; textToImageBalance?: string; visualHierarchy?: string; callToActionTreatment?: string; }
export class VisualAnalysis implements Readonly<VisualAnalysisProperties> {
  readonly imagePresence?: boolean; readonly imageType?: string; readonly visualComposition?: string; readonly graphicStyle?: string; readonly colourCharacteristics?: string; readonly typographyCharacteristics?: string; readonly layoutCharacteristics?: string; readonly textToImageBalance?: string; readonly visualHierarchy?: string; readonly callToActionTreatment?: string;
  constructor(properties: VisualAnalysisProperties = {}) { Object.assign(this, properties); Object.freeze(this); }
}
export interface ContentStructureProperties { headlineStructure?: string; sectionStructure?: string; informationOrder?: string; problemFraming?: string; solutionFraming?: string; callToActionPlacement?: string; contentDepth?: string; formatCharacteristics?: string; }
export class ContentStructureAnalysis implements Readonly<ContentStructureProperties> {
  readonly headlineStructure?: string; readonly sectionStructure?: string; readonly informationOrder?: string; readonly problemFraming?: string; readonly solutionFraming?: string; readonly callToActionPlacement?: string; readonly contentDepth?: string; readonly formatCharacteristics?: string;
  constructor(properties: ContentStructureProperties = {}) { Object.assign(this, properties); Object.freeze(this); }
}

export enum EngagementAvailability { Available="Available", Unavailable="Unavailable" }
export class EngagementSignal {
  readonly #observedAt: number;
  constructor(readonly metricType: string, readonly observedValue: number | undefined, readonly sourceId: MarketSourceId, observedAt: Date, readonly confidence: Confidence, readonly availability: EngagementAvailability) {
    text(metricType, "Engagement metric type"); this.#observedAt=date(observedAt, "Engagement observation timestamp");
    if (availability === EngagementAvailability.Available && (!Number.isFinite(observedValue) || (observedValue as number) < 0)) throw new CompetitiveIntelligenceException("Available engagement requires a non-negative observed value", "INVALID_ENGAGEMENT");
    if (availability === EngagementAvailability.Unavailable && observedValue !== undefined) throw new CompetitiveIntelligenceException("Unavailable engagement must not contain an observed value", "INVALID_ENGAGEMENT"); Object.freeze(this);
  }
  get observedAt(): Date { return new Date(this.#observedAt); }
}

export enum CompetitiveGapCategory { MissingTopic="MissingTopic", WeakExplanation="WeakExplanation", OutdatedContent="OutdatedContent", VisualWeakness="VisualWeakness", AudienceGap="AudienceGap", IntentGap="IntentGap", PresentationGap="PresentationGap", InformationGap="InformationGap" }
export class CompetitiveGap {
  readonly evidence: readonly Evidence[];
  constructor(readonly category: CompetitiveGapCategory, readonly description: string, evidence: readonly Evidence[]) { text(description, "Competitive gap description"); if (evidence.length===0) throw new CompetitiveIntelligenceException("Competitive gap requires supporting evidence", "MISSING_EVIDENCE"); this.evidence=values(evidence); Object.freeze(this); }
}

export interface CompetitiveAnalysisProperties { id: CompetitiveAnalysisId; subject: CompetitiveSubject; businessPackageId?: BusinessPackageId; sourceObservations: readonly CompetitiveObservation[]; contentProfile: CompetitiveContentProfile; keywordAnalysis: KeywordAnalysis; searchIntentAnalysis: SearchIntentAnalysis; visualAnalysis: VisualAnalysis; contentStructureAnalysis: ContentStructureAnalysis; engagementSignals: readonly EngagementSignal[]; competitiveGaps: readonly CompetitiveGap[]; confidence: Confidence; provenance: Provenance; analysisTimestamp: Date; }
export class CompetitiveAnalysis {
  readonly sourceObservations: readonly CompetitiveObservation[]; readonly engagementSignals: readonly EngagementSignal[]; readonly competitiveGaps: readonly CompetitiveGap[]; readonly #analysedAt: number;
  readonly id: CompetitiveAnalysisId; readonly subject: CompetitiveSubject; readonly businessPackageId: BusinessPackageId | undefined; readonly contentProfile: CompetitiveContentProfile; readonly keywordAnalysis: KeywordAnalysis; readonly searchIntentAnalysis: SearchIntentAnalysis; readonly visualAnalysis: VisualAnalysis; readonly contentStructureAnalysis: ContentStructureAnalysis; readonly confidence: Confidence; readonly provenance: Provenance;
  constructor(p: CompetitiveAnalysisProperties) { if (p.sourceObservations.length===0) throw new CompetitiveIntelligenceException("Analysis requires a source observation", "MISSING_OBSERVATION"); if (p.sourceObservations.some(o=>o.subject.id!==p.subject.id || o.businessPackageId?.value!==p.businessPackageId?.value)) throw new CompetitiveIntelligenceException("Analysis observations must share subject and Business Package", "PACKAGE_MISMATCH");
    this.id=p.id; this.subject=p.subject; this.businessPackageId=p.businessPackageId; this.contentProfile=p.contentProfile; this.keywordAnalysis=p.keywordAnalysis; this.searchIntentAnalysis=p.searchIntentAnalysis; this.visualAnalysis=p.visualAnalysis; this.contentStructureAnalysis=p.contentStructureAnalysis; this.confidence=p.confidence; this.provenance=p.provenance;
    this.sourceObservations=values(p.sourceObservations); this.engagementSignals=values(p.engagementSignals); this.competitiveGaps=values(p.competitiveGaps); this.#analysedAt=date(p.analysisTimestamp,"Analysis timestamp"); Object.freeze(this); }
  get analysisTimestamp(): Date { return new Date(this.#analysedAt); }
}
