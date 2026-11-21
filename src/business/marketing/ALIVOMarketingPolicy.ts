/**
 * CEO-locked ALIVO commercial communications contract.
 * Applies only to the ALIVO business package; other packages retain their own policies.
 * Approval reference: ALIVO-OS issue #130 (2026-11-21).
 */
export type MarketingChannel = "blog" | "pinterest" | "facebook" | "youtube";
export type MarketingValue = "solution" | "convenience" | "experience";
/** Customer motivations are distinct from the product-value hierarchy. */
export type MarketingNeed = "clarity" | "certainty" | "time" | "connection" | "status";

export interface MarketingAlignmentEvidence {
  /** The one dominant customer value in the message. */
  primaryValue: MarketingValue;
  /** Choose one dominant customer need for this specific piece of content. */
  primaryNeed: MarketingNeed;
  /** A concrete, realistic benefit that addresses the selected need. */
  needBenefit: string;
  /** Required when selling certainty: the credible informational basis, not a promised outcome. */
  reliabilityBasis?: string;
  /** The audience's actual question, problem or need, without a diagnosis. */
  readerProblem: string;
  /** The useful understanding or realistic next step the content provides. */
  usefulNextStep: string;
  /** Optional reasons the material makes learning easier. */
  convenienceSupport?: string;
  /** Optional emotion of clarity, calm or confidence, without promising outcomes. */
  experienceSupport?: string;
}

export interface MarketingPolicyIssue {
  code: "MarketingEvidenceMissing" | "SolutionNotPrimary" | "ReaderProblemMissing" |
    "UsefulNextStepMissing" | "UnverifiedHealthPromise" | "ManipulativeUrgency" |
    "FacebookExternalLinkInPost" | "PrimaryNeedMissing" |
    "NeedBenefitMissing" | "ReliabilityBasisMissing";
  message: string;
}

export const ALIVO_MARKETING_POLICY = Object.freeze({
  reference: "alivo:marketing:solution-convenience-experience:v2",
  approvedBy: "CEO",
  approvedOn: "2026-11-21",
  updatedOn: "2026-11-21",
  status: "LOCKED",
  primaryValue: "solution" as const,
  valueOrder: Object.freeze(["solution", "convenience", "experience"] as const),
  needPriority: Object.freeze(["clarity", "certainty", "time", "connection", "status"] as const),
  defaultPrimaryNeed: "clarity" as const,
  communicationPromise: "SOLUTION → CLARITY → TRUST",
  philosophy: "Don't fight your body. Work with it.",
  instructions: Object.freeze([
    "Lead with the reader's real problem or question and useful, evidence-grounded understanding.",
    "Present the book as a clear, practical way to learn; convenience supports the solution.",
    "Build the feeling of understanding and confidence, not an unsubstantiated medical outcome.",
    "Use a relevant, low-pressure next step: helpful answer, blog, free reading sample, then book.",
    "Never promise cures, guaranteed health results, or exploit health fears to sell.",
    "For Facebook posts, keep external URLs out of the post body; place them in a comment.",
    "Choose the one customer need this content addresses: clarity, certainty, time, connection, or status.",
    "ALIVO defaults to clarity: explain the reader's question and reduce confusion.",
    "Certainty means credible sources and transparent limits; never promise a guaranteed outcome.",
    "Save time through organized, useful information; support connection without invented communities or testimonials.",
    "Do not exploit shame, fear, or social superiority to market status.",
    "Document the concrete value, helpful next step and evidence for the selected need.",
    "Keep ALIVO's friendly and approachable tone and the brand philosophy.",
  ]),
  facebookExternalLinkPlacement: "comment" as const,
});

export type ALIVOMarketingPolicy = typeof ALIVO_MARKETING_POLICY;

export function marketingPolicyForBusinessPackage(businessPackageId: string):
  ALIVOMarketingPolicy | undefined {
  return businessPackageId.trim().toUpperCase() === "ALIVO"
    ? ALIVO_MARKETING_POLICY
    : undefined;
}

const healthPromisePatterns = [
  /\b(?:guarantee(?:d|s)?|100\s*%|always|instantly|miracle)\b[^.!?\n]{0,65}\b(?:cure|heal|reverse|treat|eliminate|prevent)\b/i,
  /\b(?:cures?|heals?)\s+(?:diabetes|cancer|arthritis|migraine|hypertension|depression|pcos)\b/i,
  /\b(?:garantiert|hundertprozentig|sofort|wunder(?:mittel)?)\b[^.!?\n]{0,65}\b(?:heilt|heilung|kuriert|beseitigt|verhindert)\b/i,
];
const urgencyPattern = /\b(?:buy now|act now|limited time|don't miss out|last chance|jetzt kaufen|nur heute|letzte chance|sofort zugreifen)\b/i;

function hasExternalUrl(text: string): boolean {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'()]+/gi)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase().replace(/^www\./, "");
      if (!["facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "fb.me"].includes(host)) {
        return true;
      }
    } catch {
      // Unknown URLs are not approved as Facebook-internal links.
      return true;
    }
  }
  return false;
}

export function reviewMarketingMessage(input: {
  businessPackageId: string;
  channel: MarketingChannel;
  text: string;
  evidence?: MarketingAlignmentEvidence;
}): readonly MarketingPolicyIssue[] {
  if (!marketingPolicyForBusinessPackage(input.businessPackageId)) return Object.freeze([]);
  const issues: MarketingPolicyIssue[] = [];
  const evidence = input.evidence;
  if (!evidence) {
    issues.push({code: "MarketingEvidenceMissing", message: "ALIVO marketing alignment evidence is required"});
  } else {
    if (!ALIVO_MARKETING_POLICY.needPriority.includes(evidence.primaryNeed))
      issues.push({code: "PrimaryNeedMissing", message: "Choose one valid primary need: clarity, certainty, time, connection or status"});
    if (!evidence.needBenefit?.trim())
      issues.push({code: "NeedBenefitMissing", message: "Describe the concrete benefit for the primary need"});
    if (evidence.primaryNeed === "certainty" && !evidence.reliabilityBasis?.trim())
      issues.push({code: "ReliabilityBasisMissing", message: "Certainty requires a credible informational basis, not a promised health outcome"});
    if (evidence.primaryValue !== "solution")
      issues.push({code: "SolutionNotPrimary", message: "SOLUTION must be the primary customer value"});
    if (!evidence.readerProblem?.trim())
      issues.push({code: "ReaderProblemMissing", message: "Identify the reader's problem or question"});
    if (!evidence.usefulNextStep?.trim())
      issues.push({code: "UsefulNextStepMissing", message: "State realistic reader value or a helpful next step"});
  }
  if (healthPromisePatterns.some(pattern => pattern.test(input.text)))
    issues.push({code: "UnverifiedHealthPromise", message: "Health outcomes must not be guaranteed or presented as cures"});
  if (urgencyPattern.test(input.text))
    issues.push({code: "ManipulativeUrgency", message: "ALIVO copy must not pressure readers with artificial urgency"});
  if (input.channel === "facebook" && hasExternalUrl(input.text))
    issues.push({code: "FacebookExternalLinkInPost", message: "External URLs belong in Facebook comments, not the post body"});
  return Object.freeze(issues.map(issue => Object.freeze(issue)));
}
