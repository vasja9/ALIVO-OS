import { BusinessPackageId } from "../../../intelligence/market/MarketIntelligenceDomain.ts";

export class LanguageMarketPolicyException extends Error {
  constructor(message: string, readonly code = "LANGUAGE_MARKET_POLICY_INVALID") {
    super(message);
    this.name = "LanguageMarketPolicyException";
  }
}

export enum ResearchLanguageMode {
  Auto = "AUTO",
  Manual = "MANUAL",
}

export type LanguageMarketResolutionSource =
  | "TaskOverride"
  | "BusinessPackageDefault"
  | "DetectedLanguageFallback"
  | "TargetMarketFallback";

const languagePattern = /^[a-z]{2,3}(?:-[a-z]{2}|-[0-9]{3})?$/i;
const marketPattern = /^[A-Z]{2,3}(?:-[A-Z0-9]{2,})?$/;

export const canonicalLanguage = (value: string, field = "Language"): string => {
  const normalized = typeof value === "string" ? value.trim().replaceAll("_", "-") : "";
  if (!languagePattern.test(normalized)) {
    throw new LanguageMarketPolicyException(`${field} "${value}" is not a valid language code.`);
  }
  const [base, region] = normalized.toLowerCase().split("-");
  return region === undefined ? base : `${base}-${region.length === 2 ? region.toUpperCase() : region}`;
};

export const canonicalMarket = (value: string, field = "Market"): string => {
  if (typeof value !== "string") {
    throw new LanguageMarketPolicyException(`${field} must be a valid market code.`);
  }
  const canonical = value.trim().replaceAll("_", "-").toUpperCase();
  if (!marketPattern.test(canonical)) {
    throw new LanguageMarketPolicyException(`${field} "${canonical}" is not a valid market code.`);
  }
  return canonical;
};

const uniqueLanguages = (languages: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const language of languages) {
    const canonical = canonicalLanguage(language, "Research language");
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return Object.freeze(normalized);
};

export const MARKET_LANGUAGE: Readonly<Record<string, string>> = Object.freeze({
  AT: "de",
  AU: "en",
  BR: "pt",
  CA: "en",
  CH: "de",
  CN: "zh",
  DE: "de",
  ES: "es",
  FR: "fr",
  GB: "en",
  HK: "zh",
  IN: "en",
  IT: "it",
  JP: "ja",
  KR: "ko",
  MX: "es",
  NL: "nl",
  NZ: "en",
  PT: "pt",
  TW: "zh",
  US: "en",
});

export const languageForMarket = (market: string): string | undefined => {
  const canonical = canonicalMarket(market);
  const localeLanguage = canonical.match(/^([A-Z]{2,3})-[A-Z0-9]+$/)?.[1];
  return MARKET_LANGUAGE[localeLanguage ?? canonical];
};

export class ResearchLanguagePolicy {
  readonly languages: readonly string[];

  constructor(
    readonly mode: ResearchLanguageMode,
    languages: readonly string[] = [],
  ) {
    if (!Object.values(ResearchLanguageMode).includes(mode)) {
      throw new LanguageMarketPolicyException("Research language mode is invalid.");
    }
    if (mode === ResearchLanguageMode.Auto && languages.length > 0) {
      throw new LanguageMarketPolicyException("AUTO research language policy cannot contain a manual language list.");
    }
    if (mode === ResearchLanguageMode.Manual && languages.length === 0) {
      throw new LanguageMarketPolicyException("Manual research language policy requires at least one language.");
    }
    this.languages = uniqueLanguages(languages);
    Object.freeze(this);
  }

  static auto(): ResearchLanguagePolicy {
    return new ResearchLanguagePolicy(ResearchLanguageMode.Auto);
  }

  static manual(languages: readonly string[]): ResearchLanguagePolicy {
    return new ResearchLanguagePolicy(ResearchLanguageMode.Manual, languages);
  }
}

interface ResearchPolicyInput {
  readonly researchLanguagePolicy?: ResearchLanguagePolicy;
  readonly researchLanguageMode?: ResearchLanguageMode;
  readonly researchLanguages?: readonly string[];
}

const researchPolicyFrom = (input: ResearchPolicyInput): ResearchLanguagePolicy => {
  const hasConvenienceInput = input.researchLanguageMode !== undefined || input.researchLanguages !== undefined;
  if (input.researchLanguagePolicy !== undefined && hasConvenienceInput) {
    throw new LanguageMarketPolicyException("Research language policy may use one input shape only.");
  }
  if (input.researchLanguagePolicy !== undefined) {
    if (!(input.researchLanguagePolicy instanceof ResearchLanguagePolicy)) {
      throw new LanguageMarketPolicyException("Research language policy is invalid.");
    }
    return input.researchLanguagePolicy;
  }
  return new ResearchLanguagePolicy(
    input.researchLanguageMode ?? ResearchLanguageMode.Auto,
    input.researchLanguages ?? [],
  );
};

export interface BusinessPackageLanguageMarketPolicyProperties extends ResearchPolicyInput {
  readonly businessPackageId: BusinessPackageId;
  readonly contentWriteLanguage?: string;
  readonly publishingLanguage?: string;
  readonly targetMarket: string;
}

export class BusinessPackageLanguageMarketPolicy {
  readonly properties: BusinessPackageLanguageMarketPolicyProperties;
  readonly researchLanguagePolicy: ResearchLanguagePolicy;
  readonly contentWriteLanguage?: string;
  readonly publishingLanguage?: string;
  readonly targetMarket: string;

  constructor(properties: BusinessPackageLanguageMarketPolicyProperties) {
    if (!(properties.businessPackageId instanceof BusinessPackageId)) {
      throw new LanguageMarketPolicyException("Business Package is required.");
    }
    const contentWriteLanguage = properties.contentWriteLanguage === undefined
      ? undefined
      : canonicalLanguage(properties.contentWriteLanguage, "Content/write language");
    const publishingLanguage = properties.publishingLanguage === undefined
      ? undefined
      : canonicalLanguage(properties.publishingLanguage, "Publishing language");
    const targetMarket = canonicalMarket(properties.targetMarket, "Target market");
    const researchLanguagePolicy = researchPolicyFrom(properties);
    this.properties = Object.freeze({
      businessPackageId: properties.businessPackageId,
      contentWriteLanguage,
      publishingLanguage,
      targetMarket,
      researchLanguagePolicy,
    });
    this.contentWriteLanguage = contentWriteLanguage;
    this.publishingLanguage = publishingLanguage;
    this.targetMarket = targetMarket;
    this.researchLanguagePolicy = researchLanguagePolicy;
    Object.freeze(this);
  }

  get businessPackageId(): BusinessPackageId {
    return this.properties.businessPackageId;
  }
}

export interface ContentOpportunityLanguageMarketTaskOverrideProperties extends ResearchPolicyInput {
  readonly contentWriteLanguage?: string;
  readonly publishingLanguage?: string;
  readonly targetMarket?: string;
}

export class ContentOpportunityLanguageMarketTaskOverride {
  readonly properties: ContentOpportunityLanguageMarketTaskOverrideProperties;
  readonly researchLanguagePolicy?: ResearchLanguagePolicy;
  readonly contentWriteLanguage?: string;
  readonly publishingLanguage?: string;
  readonly targetMarket?: string;

  constructor(properties: ContentOpportunityLanguageMarketTaskOverrideProperties) {
    const contentWriteLanguage = properties.contentWriteLanguage === undefined
      ? undefined
      : canonicalLanguage(properties.contentWriteLanguage, "Task content/write language");
    const publishingLanguage = properties.publishingLanguage === undefined
      ? undefined
      : canonicalLanguage(properties.publishingLanguage, "Task publishing language");
    const targetMarket = properties.targetMarket === undefined
      ? undefined
      : canonicalMarket(properties.targetMarket, "Task target market");
    const researchLanguagePolicy = (
      properties.researchLanguagePolicy === undefined
      && properties.researchLanguageMode === undefined
      && properties.researchLanguages === undefined
    ) ? undefined : researchPolicyFrom(properties);
    this.properties = Object.freeze({
      contentWriteLanguage,
      publishingLanguage,
      targetMarket,
      researchLanguagePolicy,
    });
    this.contentWriteLanguage = contentWriteLanguage;
    this.publishingLanguage = publishingLanguage;
    this.targetMarket = targetMarket;
    this.researchLanguagePolicy = researchLanguagePolicy;
    Object.freeze(this);
  }

  get researchLanguageMode(): ResearchLanguageMode | undefined {
    return this.researchLanguagePolicy?.mode;
  }

  get researchLanguages(): readonly string[] | undefined {
    return this.researchLanguagePolicy?.languages;
  }
}

export interface ResolvedContentOpportunityLanguageMarketPolicyProperties {
  readonly businessPackageId: BusinessPackageId;
  readonly contentWriteLanguage: string;
  readonly researchLanguages: readonly string[];
  readonly researchLanguageMode: ResearchLanguageMode;
  readonly publishingLanguage: string;
  readonly targetMarket: string;
  readonly detectedLanguage?: string;
  readonly contentWriteLanguageSource: LanguageMarketResolutionSource;
}

export class ResolvedContentOpportunityLanguageMarketPolicy {
  readonly properties: ResolvedContentOpportunityLanguageMarketPolicyProperties;
  readonly researchLanguages: readonly string[];

  constructor(properties: ResolvedContentOpportunityLanguageMarketPolicyProperties) {
    if (!(properties.businessPackageId instanceof BusinessPackageId)) {
      throw new LanguageMarketPolicyException("Resolved Business Package is invalid.");
    }
    const researchLanguages = Object.freeze([...properties.researchLanguages]);
    this.properties = Object.freeze({ ...properties, researchLanguages });
    this.researchLanguages = researchLanguages;
    Object.freeze(this);
  }

  get businessPackageId(): BusinessPackageId {
    return this.properties.businessPackageId;
  }

  get contentWriteLanguage(): string {
    return this.properties.contentWriteLanguage;
  }

  get researchLanguageMode(): ResearchLanguageMode {
    return this.properties.researchLanguageMode;
  }

  get publishingLanguage(): string {
    return this.properties.publishingLanguage;
  }

  get targetMarket(): string {
    return this.properties.targetMarket;
  }

  get detectedLanguage(): string | undefined {
    return this.properties.detectedLanguage;
  }

  get contentWriteLanguageSource(): LanguageMarketResolutionSource {
    return this.properties.contentWriteLanguageSource;
  }
}

export interface ContentOpportunityLanguageMarketResolutionOptions {
  readonly detectedLanguage?: string;
  readonly taskOverride?: ContentOpportunityLanguageMarketTaskOverride;
}

export class ContentOpportunityLanguageMarketPolicyResolver {
  resolve(
    policy: BusinessPackageLanguageMarketPolicy,
    options: ContentOpportunityLanguageMarketResolutionOptions = {},
  ): ResolvedContentOpportunityLanguageMarketPolicy {
    if (!(policy instanceof BusinessPackageLanguageMarketPolicy)) {
      throw new LanguageMarketPolicyException("Business Package language and market policy is invalid.");
    }
    if (options.taskOverride !== undefined && !(options.taskOverride instanceof ContentOpportunityLanguageMarketTaskOverride)) {
      throw new LanguageMarketPolicyException("Task language and market override is invalid.");
    }

    const taskOverride = options.taskOverride;
    const targetMarket = taskOverride?.targetMarket ?? policy.targetMarket;
    const marketLanguage = languageForMarket(targetMarket);
    const detectedLanguage = options.detectedLanguage === undefined
      ? undefined
      : canonicalLanguage(options.detectedLanguage, "Detected language");
    const contentWriteLanguage = taskOverride?.contentWriteLanguage
      ?? policy.contentWriteLanguage
      ?? detectedLanguage
      ?? marketLanguage;

    if (contentWriteLanguage === undefined) {
      throw new LanguageMarketPolicyException(
        `Content/write language cannot be resolved for target market "${targetMarket}".`,
      );
    }

    const contentWriteLanguageSource: LanguageMarketResolutionSource = taskOverride?.contentWriteLanguage !== undefined
      ? "TaskOverride"
      : policy.contentWriteLanguage !== undefined
        ? "BusinessPackageDefault"
        : detectedLanguage !== undefined
          ? "DetectedLanguageFallback"
          : "TargetMarketFallback";

    const selectedResearchPolicy = taskOverride?.researchLanguagePolicy ?? policy.researchLanguagePolicy;
    const researchLanguages = selectedResearchPolicy.mode === ResearchLanguageMode.Auto
      ? uniqueLanguages([contentWriteLanguage, ...(contentWriteLanguage === "en" ? [] : ["en"])])
      : selectedResearchPolicy.languages;

    return new ResolvedContentOpportunityLanguageMarketPolicy({
      businessPackageId: policy.businessPackageId,
      contentWriteLanguage,
      researchLanguages,
      researchLanguageMode: selectedResearchPolicy.mode,
      publishingLanguage: taskOverride?.publishingLanguage
        ?? policy.publishingLanguage
        ?? contentWriteLanguage,
      targetMarket,
      detectedLanguage,
      contentWriteLanguageSource,
    });
  }
}