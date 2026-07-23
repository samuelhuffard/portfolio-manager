// Aggregate-only accounting for the research funnel. This is observability, not
// a ranking or proposal policy: it must never influence which name is selected
// or whether an actionable proposal can be created.
export const RESEARCH_FUNNEL_VERSION = "research-funnel-v1";

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function slateCount(counts) {
  return Object.values(counts ?? {}).reduce((total, value) => total + count(value), 0);
}

export function blankResearchFunnel({ discovery = null, cataloged = 0, fundamentalsRequested = 0 } = {}) {
  return {
    version: RESEARCH_FUNNEL_VERSION,
    cataloged: count(cataloged),
    visible: count(discovery?.visible),
    discoveryEligible: count(discovery?.eligible),
    discoveryScreenedOut: count(discovery?.screenedOut),
    slate: slateCount(discovery?.counts),
    fundamentalsRequested: count(fundamentalsRequested),
    fundamentalsAvailable: 0,
    fundamentalsUnavailable: 0,
    candidatesBuilt: 0,
    freshScreenPassed: 0,
    freshScreenRejected: 0,
    mandatoryHoldingOverrides: 0,
    deepReviews: 0,
    dataBlocked: 0,
    generatorHold: 0,
    generatorActionable: 0,
    riskDowngraded: 0,
    evaluatorApproved: 0,
    evaluatorRejected: 0,
    evaluatorErrored: 0,
    duplicateBlocked: 0,
    proposalBlocked: 0,
    proposalCreated: 0,
    reviewErrors: 0,
  };
}

export function recordCandidateBuild(funnel, {
  fundamentalsAvailable,
  candidatesBuilt,
  freshScreenPassed,
  freshScreenRejected,
  mandatoryHoldingOverrides,
} = {}) {
  const requested = count(funnel?.fundamentalsRequested);
  const available = count(fundamentalsAvailable);
  return {
    ...funnel,
    fundamentalsAvailable: available,
    fundamentalsUnavailable: Math.max(0, requested - available),
    candidatesBuilt: count(candidatesBuilt),
    freshScreenPassed: count(freshScreenPassed),
    freshScreenRejected: count(freshScreenRejected),
    mandatoryHoldingOverrides: count(mandatoryHoldingOverrides),
  };
}

// A review can meet multiple later-stage conditions (for example, a generator
// BUY may be downgraded by risk and never reach the evaluator), so these are
// diagnostic counters rather than a partition that must sum to deepReviews.
export function recordResearchReview(funnel, facts = {}) {
  const next = { ...funnel, deepReviews: count(funnel?.deepReviews) + 1 };
  if (facts.dataGateBlocked) next.dataBlocked += 1;
  if (facts.generatorAction === "HOLD") next.generatorHold += 1;
  if (facts.generatorAction === "BUY" || facts.generatorAction === "SELL") next.generatorActionable += 1;
  if (facts.riskOverridden) next.riskDowngraded += 1;
  if (facts.evaluatorState === "approved") next.evaluatorApproved += 1;
  if (facts.evaluatorState === "rejected") next.evaluatorRejected += 1;
  if (facts.evaluatorState === "error") next.evaluatorErrored += 1;
  if (facts.duplicateOpen) next.duplicateBlocked += 1;
  if (facts.proposalDisposition === "blocked" || facts.proposalDisposition === "paper_only") next.proposalBlocked += 1;
  if (facts.proposalDisposition === "created") next.proposalCreated += 1;
  if (facts.failureKind === "review_error" || facts.failureKind === "budget_exhausted") next.reviewErrors += 1;
  return next;
}
