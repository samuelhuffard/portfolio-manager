import { contentHash, canonicalJson } from "../lib/research-version.js";
import { applyTransactionCosts, computeForwardMetrics, summarizeSamples, turnover } from "./metrics.js";
import { assertWalkForwardInputs } from "./loaders/point-in-time.js";

const DAY_MS = 86400000;
const DISCOVERY_CATEGORIES = new Set(["discovery", "rotation", "top_score", "score_change", "exploration", "random_baseline"]);
const MANDATORY_CATEGORIES = new Set(["holding", "mandatory_review"]);
const SUPPORTED_SELECTION_CATEGORIES = new Set([...DISCOVERY_CATEGORIES, ...MANDATORY_CATEGORIES]);

function requiredString(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function timestamp(value, path) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${path} requires an ISO timestamp`);
  return parsed;
}

function canonicalDate(value, path) {
  return new Date(timestamp(value, path)).toISOString();
}

function rounded(value) {
  return value == null ? null : Number(value.toFixed(12));
}

function reasonCounts(outcomes) {
  const counts = {};
  for (const outcome of outcomes) {
    if (!outcome.reason) continue;
    counts[outcome.reason] = (counts[outcome.reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function seededRandom(seed) {
  let state = Number.parseInt(contentHash({ seed }).slice(0, 8), 16) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function selectDeterministicRandomBaseline({ eligible = [], count, seed }) {
  const random = seededRandom(requiredString(seed, "seed"));
  const rows = [...eligible].sort((left, right) => String(left.securityId).localeCompare(String(right.securityId)));
  for (let index = rows.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [rows[index], rows[swap]] = [rows[swap], rows[index]];
  }
  return rows.slice(0, Math.max(0, Math.min(Number(count) || 0, rows.length))).map((row) => ({ ...row }));
}

function costForScenario(costPolicy, scenario, context) {
  const model = costPolicy?.[scenario];
  if (typeof model !== "function") return null;
  const entryCostRate = model({ ...context, scenario, phase: "entry" });
  const exitCostRate = model({ ...context, scenario, phase: "exit" });
  return {
    entryCostRate,
    exitCostRate,
    netReturn: applyTransactionCosts({ grossReturn: context.grossReturn, entryCostRate, exitCostRate }),
  };
}

function isDiscovery(decision) {
  return DISCOVERY_CATEGORIES.has(decision.selectionCategory);
}

function selectionCategoryFor(decision, id) {
  const category = requiredString(decision.selectionCategory, `decision ${id}.selectionCategory`);
  if (!SUPPORTED_SELECTION_CATEGORIES.has(category)) {
    throw new TypeError(`decision ${id}.selectionCategory is unsupported: ${category}`);
  }
  return category;
}

function replayDecision({ decision, loader, benchmarkSecurityId, horizonDays, asOf, costPolicy, random }) {
  const id = requiredString(decision.id, "decision.id");
  const securityId = requiredString(decision.securityId ?? decision.ticker, `decision ${id}.securityId`);
  const decisionAt = canonicalDate(decision.decisionAt ?? decision.observedAt, `decision ${id}.decisionAt`);
  const selectionCategory = selectionCategoryFor(decision, id);
  const snapshot = loader.snapshotAt(decisionAt);
  const universeEntry = snapshot.universe.find((entry) => entry.securityId === securityId);
  const base = {
    id,
    securityId,
    ticker: decision.ticker ?? securityId,
    decisionAt,
    selectionCategory,
    discoveryComparison: isDiscovery({ selectionCategory }),
    visibleEvidenceIds: snapshot.evidence.map((event) => event.id).sort(),
    activePolicyVersions: Object.fromEntries(snapshot.policies.map((policy) => [policy.policyType, policy.version])),
  };
  if (!universeEntry?.eligible) {
    return { ...base, status: "excluded", reason: universeEntry?.exclusionReason ?? "not_eligible_at_decision_time", metrics: null };
  }

  const execution = loader.nextRegularSessionPrice(securityId, decisionAt);
  if (!execution) return { ...base, status: "unavailable", reason: "missing_next_regular_session_price", metrics: null };
  const targetAt = new Date(timestamp(execution.executableAt, "execution.executableAt") + (horizonDays * DAY_MS)).toISOString();
  if (timestamp(asOf, "asOf") < timestamp(targetAt, "targetAt")) {
    return { ...base, status: "immature", reason: "horizon_not_mature", executionAt: execution.executableAt, targetAt, metrics: null };
  }

  const securityExit = loader.firstCompletedPriceAtOrAfter(securityId, targetAt, asOf);
  if (!securityExit) {
    return { ...base, status: "unavailable", reason: "missing_security_horizon_price", executionAt: execution.executableAt, targetAt, metrics: null };
  }
  const benchmarkEntry = benchmarkSecurityId ? loader.firstCompletedPriceAtOrAfter(benchmarkSecurityId, execution.executableAt, asOf) : null;
  const benchmarkExit = benchmarkEntry ? loader.firstCompletedPriceAtOrAfter(benchmarkSecurityId, targetAt, asOf) : null;
  const pricePath = loader.completedPricePath(securityId, execution.completedAt, securityExit.completedAt);
  const metrics = computeForwardMetrics({ securityEntry: execution, securityExit, benchmarkEntry, benchmarkExit, pricePath });
  const context = {
    decision: { ...decision },
    securityId,
    execution,
    exit: securityExit,
    grossReturn: metrics.forwardTotalReturn,
    random,
  };
  const baseCosts = costForScenario(costPolicy, "base", context);
  const stressedCosts = costForScenario(costPolicy, "stressed", context);
  return {
    ...base,
    status: "matured",
    reason: benchmarkSecurityId && (!benchmarkEntry || !benchmarkExit) ? "benchmark_unavailable" : null,
    executionAt: execution.executableAt,
    targetAt,
    exitAt: securityExit.completedAt,
    metrics: {
      ...metrics,
      baseNetReturn: baseCosts?.netReturn ?? null,
      stressedNetReturn: stressedCosts?.netReturn ?? null,
      baseCosts: baseCosts == null ? null : { entryCostRate: baseCosts.entryCostRate, exitCostRate: baseCosts.exitCostRate },
      stressedCosts: stressedCosts == null ? null : { entryCostRate: stressedCosts.entryCostRate, exitCostRate: stressedCosts.exitCostRate },
    },
  };
}

/**
 * Pure deterministic replay. It accepts only injected, point-in-time records;
 * no network, DB, Redis, Sheets, broker, or production data is reachable.
 */
export function runMandateBacktest({
  loader,
  decisions = [],
  runId,
  codeRevision,
  methodologyVersion,
  mandateVersion,
  scoringVersion,
  universeVersion,
  selectionVersion,
  snapshotIds = {},
  snapshotHashes = {},
  params = {},
  seed,
  startAt,
  endAt,
  asOf = endAt,
  benchmarkSecurityId = null,
  horizonDays,
  costPolicy = null,
  hitDefinition = null,
  walkForwardInputs = null,
  averageCapital = null,
  randomBaseline = null,
} = {}) {
  if (!loader || typeof loader.snapshotAt !== "function" || typeof loader.nextRegularSessionPrice !== "function") {
    throw new TypeError("loader must be a point-in-time loader");
  }
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) throw new TypeError("horizonDays must be a positive integer");
  if (!Array.isArray(decisions)) throw new TypeError("decisions must be an array");
  if (hitDefinition != null && typeof hitDefinition !== "function") throw new TypeError("hitDefinition must be a function or null");
  if (hitDefinition != null) requiredString(params?.hitDefinitionVersion, "params.hitDefinitionVersion");
  const normalizedStartAt = canonicalDate(startAt, "startAt");
  const normalizedEndAt = canonicalDate(endAt, "endAt");
  const normalizedAsOf = canonicalDate(asOf, "asOf");
  if (timestamp(normalizedStartAt, "startAt") > timestamp(normalizedEndAt, "endAt")) {
    throw new RangeError("startAt must be earlier than or equal to endAt");
  }
  if (timestamp(normalizedEndAt, "endAt") > timestamp(normalizedAsOf, "asOf")) {
    throw new RangeError("endAt must be earlier than or equal to asOf");
  }
  if (walkForwardInputs) assertWalkForwardInputs({ evaluationAt: normalizedStartAt, ...walkForwardInputs });
  const identity = {
    runId: requiredString(runId, "runId"),
    codeRevision: requiredString(codeRevision, "codeRevision"),
    methodologyVersion: requiredString(methodologyVersion, "methodologyVersion"),
    mandateVersion: requiredString(mandateVersion, "mandateVersion"),
    scoringVersion: requiredString(scoringVersion, "scoringVersion"),
    universeVersion: requiredString(universeVersion, "universeVersion"),
    selectionVersion: requiredString(selectionVersion, "selectionVersion"),
    snapshotIds: { ...snapshotIds },
    snapshotHashes: { ...snapshotHashes },
    params: { ...params },
    seed: requiredString(seed, "seed"),
    startAt: normalizedStartAt,
    endAt: normalizedEndAt,
    asOf: normalizedAsOf,
    benchmarkSecurityId: benchmarkSecurityId == null ? null : requiredString(benchmarkSecurityId, "benchmarkSecurityId"),
    horizonDays,
    costPolicyVersion: costPolicy?.version ?? null,
  };
  for (const decision of decisions) {
    const decisionAt = timestamp(decision?.decisionAt ?? decision?.observedAt, "decisionAt");
    if (decisionAt < timestamp(identity.startAt, "startAt") || decisionAt > timestamp(identity.endAt, "endAt")) {
      throw new RangeError("decisionAt must be inside the declared [startAt, endAt] window");
    }
    selectionCategoryFor(decision, requiredString(decision?.id, "decision.id"));
  }
  const random = seededRandom(identity.seed);
  const ordered = [...decisions].sort((left, right) =>
    timestamp(left.decisionAt ?? left.observedAt, "decisionAt") - timestamp(right.decisionAt ?? right.observedAt, "decisionAt") ||
    String(left.id).localeCompare(String(right.id)),
  );
  const outcomes = ordered.map((decision) => replayDecision({
    decision,
    loader,
    benchmarkSecurityId: identity.benchmarkSecurityId,
    horizonDays,
    asOf: identity.asOf,
    costPolicy,
    random,
  }));
  let randomBaselineResult = null;
  if (randomBaseline != null) {
    const count = Number(randomBaseline.count);
    if (!Number.isInteger(count) || count < 0) throw new TypeError("randomBaseline.count must be a nonnegative integer");
    const at = canonicalDate(randomBaseline.at ?? identity.startAt, "randomBaseline.at");
    const baselineAt = timestamp(at, "randomBaseline.at");
    if (baselineAt < timestamp(identity.startAt, "startAt") || baselineAt > timestamp(identity.endAt, "endAt") ||
      baselineAt > timestamp(identity.asOf, "asOf")) {
      throw new RangeError("randomBaseline.at must be inside the declared window and no later than asOf");
    }
    const eligible = loader.snapshotAt(at).universe.filter((entry) => entry.eligible);
    randomBaselineResult = {
      at,
      count,
      selectedSecurityIds: selectDeterministicRandomBaseline({ eligible, count, seed: identity.seed }).map((entry) => entry.securityId),
    };
  }
  const discoveryOutcomes = outcomes.filter((outcome) => outcome.discoveryComparison);
  const mandatoryOutcomes = outcomes.filter((outcome) => !outcome.discoveryComparison);
  const allTrades = outcomes.filter((outcome) => outcome.status === "matured").map((outcome) => ({
    notional: decisions.find((decision) => decision.id === outcome.id)?.notional ?? 0,
  }));
  const base = {
    identity,
    counts: {
      observations: outcomes.length,
      discoveryObservations: discoveryOutcomes.length,
      mandatoryOrHoldingObservations: mandatoryOutcomes.length,
      ...Object.fromEntries(["matured", "immature", "unavailable", "excluded"].map((status) => [status, outcomes.filter((outcome) => outcome.status === status).length])),
    },
    exclusions: reasonCounts(outcomes),
    results: {
      overall: summarizeSamples({ outcomes, hitDefinition }),
      discovery: summarizeSamples({ outcomes: discoveryOutcomes, hitDefinition }),
      mandatoryOrHoldings: summarizeSamples({ outcomes: mandatoryOutcomes, hitDefinition }),
      randomBaseline: randomBaselineResult,
      turnover: turnover({ trades: allTrades, averageCapital }),
      outcomes,
    },
    report: `Frozen methodology replay: ${outcomes.length} observations; ${outcomes.filter((outcome) => outcome.status === "matured").length} matured; ${outcomes.filter((outcome) => outcome.status === "unavailable").length} unavailable; ${outcomes.filter((outcome) => outcome.status === "immature").length} immature. No edge or promotion conclusion is implied.`,
  };
  const resultHash = contentHash(base);
  const artifact = { ...base, resultHash };
  return { artifact, canonicalResult: canonicalJson(artifact) };
}

export default runMandateBacktest;
