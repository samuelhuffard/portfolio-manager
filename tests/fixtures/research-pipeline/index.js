import { BudgetExhaustedError } from "../../../lib/ai-budget.js";
import { RESEARCH_PIPELINE_DEFAULTS } from "../../../jobs/research-scan.js";

export function buyRecommendation(overrides = {}) {
  return {
    action: "BUY",
    targetWeight: 10,
    thesis: "Quant score 82 supports a measured starter position.",
    risks: ["Revenue growth could slow."],
    killCriteria: ["Exit if revenue growth falls below 10% next quarter."],
    confidence: 0.8,
    suspectEvidence: [],
    ...overrides,
  };
}

export function evaluatorResult(verdict = "APPROVE", overrides = {}) {
  return {
    verdict,
    critique: verdict === "APPROVE" ? ["proposal is supported"] : ["proposal is not admissible"],
    numericSpotCheck: "pass",
    suspectEvidence: [],
    parseError: false,
    ...overrides,
  };
}

export function makeResearchPipelineFixture({
  generatorResults = [buyRecommendation()],
  evaluatorResults = [evaluatorResult()],
  generatorError = null,
  evaluatorError = null,
  openProposals = [],
  queueResult = undefined,
  queueError = null,
  dataGate = { ok: true, stale: false, reasons: [] },
  evaluatorAdmissionPolicy = null,
} = {}) {
  const calls = {
    generator: 0,
    evaluator: 0,
    queue: 0,
    tavily: 0,
    athena: 0,
  };
  const order = [];
  const queuedInputs = [];
  const generators = [...generatorResults];
  const evaluators = [...evaluatorResults];

  const agent = { id: "agent-2", name: "Contract Fixture", executionEligibility: "supervised" };
  const candidate = {
    ticker: "ACME",
    name: "Acme Systems",
    quantScore: 82,
    breakdown: { growth: 84, quality: 80 },
    dataGate,
    subVertical: "Software",
    marketCap: 2_000_000_000,
    avgDollarVolume: 20_000_000,
    momentum3m: 0.12,
    momentum1m: 0.04,
    rsi: 58,
    nextEarningsDate: null,
    analystTrend: null,
    insiderActivity: null,
    raw: {
      price: { regularMarketPrice: 50, marketCap: 2_000_000_000 },
      defaultKeyStatistics: { trailingEps: 2, forwardEps: 2.4 },
      summaryDetail: { trailingPE: 25, forwardPE: 20 },
      financialData: {
        revenueGrowth: 0.2,
        earningsGrowth: 0.18,
        grossMargins: 0.6,
        profitMargins: 0.15,
        freeCashflow: 100_000_000,
      },
    },
  };
  const context = {
    riskLimits: {
      blockOnStaleData: true,
      prohibitAveragingDown: true,
      requireBearCase: true,
      minConfidence: 0.4,
      maxPositionPct: 15,
      maxSectorPct: 75,
      maxSubVerticalPct: 75,
      percentageSizingMinPortfolioValue: 0,
      ordinarySellCooldownDays: 7,
    },
    spyEntryPrice: 600,
    availableCashForBuys: 5_000,
    strategyNotes: "",
    holdingTickers: [],
    persistentMemory: "",
    marketScans: [],
    researchLedger: {},
    boundaryToken: "fixture-boundary",
    heldReturnPct: {},
    tickerWeightPct: {},
    subVerticalWeightPct: {},
    heldAllocation: [],
    totalPortfolioValue: 10_000,
    openProposals: [...openProposals],
    ordinarySellCooldownDays: 7,
    breaker: { tier: "NONE", drawdownPct: 0 },
    evidenceFlags: [],
    athenaCircuit: {},
    macroText: "",
    budget: {},
  };

  const dependencies = {
    getCachedNews: async () => {
      order.push("news");
      return [{ title: "Acme reports", content: "Results were stable.", url: "https://fixture.invalid/acme" }];
    },
    tavilySearch: async () => {
      calls.tavily += 1;
      throw new Error("network access is forbidden in research-pipeline fixtures");
    },
    setCachedNews: async () => {
      throw new Error("external cache writes are forbidden in research-pipeline fixtures");
    },
    getAthenaConfig: () => null,
    fetchAthenaDossier: async () => {
      calls.athena += 1;
      throw new Error("Athena access is forbidden in research-pipeline fixtures");
    },
    fetchRecentFilings: async () => {
      order.push("filings");
      return [];
    },
    getAIRecommendation: async () => {
      calls.generator += 1;
      order.push("generator");
      if (generatorError) throw generatorError;
      const next = generators.shift();
      if (!next) throw new Error("unexpected extra generator call");
      return structuredClone(next);
    },
    applyRiskChecks: (...args) => {
      order.push("risk");
      return RESEARCH_PIPELINE_DEFAULTS.applyRiskChecks(...args);
    },
    applyConvictionClamp: (...args) => {
      order.push("conviction");
      return RESEARCH_PIPELINE_DEFAULTS.applyConvictionClamp(...args);
    },
    applyBreakerToProposal: (...args) => {
      order.push("breaker");
      return RESEARCH_PIPELINE_DEFAULTS.applyBreakerToProposal(...args);
    },
    hasOpenProposal: (...args) => {
      order.push("duplicate_check");
      return RESEARCH_PIPELINE_DEFAULTS.hasOpenProposal(...args);
    },
    hasRecentProposal: (...args) => {
      order.push("recent_check");
      return RESEARCH_PIPELINE_DEFAULTS.hasRecentProposal(...args);
    },
    evaluateProposal: async () => {
      calls.evaluator += 1;
      order.push("evaluator");
      if (evaluatorError) throw evaluatorError;
      const next = evaluators.shift();
      if (!next) throw new Error("unexpected extra evaluator call");
      return structuredClone(next);
    },
    resolveFinalVerdict: (...args) => {
      order.push("resolve_verdict");
      return RESEARCH_PIPELINE_DEFAULTS.resolveFinalVerdict(...args);
    },
    canCreateActionableProposal: (...args) => {
      order.push("eligibility");
      return RESEARCH_PIPELINE_DEFAULTS.canCreateActionableProposal(...args);
    },
    sizeProposalAmount: (...args) => {
      order.push("sizing");
      return RESEARCH_PIPELINE_DEFAULTS.sizeProposalAmount(...args);
    },
    createProposal: async (input) => {
      calls.queue += 1;
      order.push("queue");
      queuedInputs.push(structuredClone(input));
      if (queueError) throw queueError;
      if (queueResult !== undefined) return queueResult;
      return {
        id: `fixture-proposal-${calls.queue}`,
        status: "Pending",
        createdAt: "2026-07-16T12:00:00.000Z",
        ...input,
      };
    },
    evaluatorAdmissionPolicy,
  };

  return { agent, candidate, context, dependencies, calls, order, queuedInputs };
}

export function budgetFailure(message = "research run budget exhausted before generator") {
  return new BudgetExhaustedError(message);
}
