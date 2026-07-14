import { canonicalJson, contentHash } from "./research-version.js";
import { applyTransactionCosts, computeForwardMetrics } from "../backtest/metrics.js";

const DAY_MS = 86400000;
const STATUSES = new Set(["immature", "matured", "unavailable", "excluded"]);
const EVIDENCE_CLASSES = new Set(["backtest", "shadow", "paper", "realized_live"]);

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

function iso(value, path) {
  return new Date(timestamp(value, path)).toISOString();
}

function finite(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${path} requires a finite number`);
  return number;
}

function positiveRecordValue(record, path) {
  if (record == null) return null;
  for (const key of ["totalReturnIndex", "price", "close", "executablePrice"]) {
    if (!(key in record) || record[key] == null) continue;
    const value = finite(record[key], `${path}.${key}`);
    if (value <= 0) throw new RangeError(`${path}.${key} requires a positive number`);
    return value;
  }
  return null;
}

function recordTime(record, path, names = ["completedAt", "timestamp"]) {
  if (record == null) return null;
  for (const name of names) {
    if (record[name] != null) return iso(record[name], `${path}.${name}`);
  }
  return null;
}

function versionedPolicy(policy, name, required = true) {
  if (policy == null) {
    if (required) throw new TypeError(`${name} is required`);
    return null;
  }
  if (typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError(`${name} must be a versioned object`);
  }
  const version = requiredString(policy.version, `${name}.version`);
  return { policy, version };
}

function benchmarkId(policy) {
  return policy?.benchmarkSecurityId ?? policy?.securityId ?? policy?.benchmarkId ?? null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function strataFor(input) {
  const supplied = input.strata && typeof input.strata === "object" ? input.strata : {};
  return {
    agentId: firstDefined(input.agentId, supplied.agentId) ?? null,
    mandateVersion: firstDefined(input.mandateVersion, supplied.mandateVersion) ?? null,
    scoringVersion: firstDefined(input.scoringVersion, input.scoringConfigVersion, supplied.scoringVersion, supplied.scoringConfigVersion) ?? null,
    scoreCompleteness: firstDefined(input.scoreCompleteness, input.completeness, supplied.scoreCompleteness, supplied.completeness) ?? null,
    deltaCause: firstDefined(input.deltaCause, input.scoreDeltaCause, supplied.deltaCause, supplied.scoreDeltaCause) ?? null,
    agentStratum: firstDefined(input.agentStratum, supplied.agentStratum) ?? null,
    selectionCategory: firstDefined(input.selectionCategory, input.category, supplied.selectionCategory, supplied.category) ?? null,
    scoreBand: firstDefined(input.scoreBand, supplied.scoreBand) ?? null,
    regime: firstDefined(input.regime, supplied.regime) ?? null,
  };
}

function identityFor(input, entry, strata) {
  const candidates = [
    ["input.securityId", input.securityId],
    ["input.ticker", input.ticker],
    ["securityEntry.securityId", entry?.securityId],
    ["securityEntry.ticker", entry?.ticker],
  ].filter(([, value]) => value != null && String(value).trim());
  const securityId = candidates.length ? String(candidates[0][1]).trim().toUpperCase() : "";
  if (!securityId) throw new TypeError("outcome requires a nonempty securityId or ticker");
  for (const [path, value] of candidates) {
    if (String(value).trim().toUpperCase() !== securityId) throw new TypeError(`${path} does not match outcome security identity`);
  }
  const observationId = firstDefined(input.observationId, entry?.observationId);
  const selectionItemId = firstDefined(input.selectionItemId, input.itemId, entry?.selectionItemId, entry?.itemId);
  const comparisonPairId = firstDefined(input.comparisonPairId, entry?.comparisonPairId);
  if (![observationId, selectionItemId].some((value) => value != null && String(value).trim())) {
    throw new TypeError("outcome requires durable observationId or selectionItemId lineage");
  }
  return {
    runId: firstDefined(input.runId, input.selectionRunId, entry?.runId) ?? null,
    selectionRunId: firstDefined(input.selectionRunId, entry?.selectionRunId, entry?.runId) ?? null,
    selectionItemId: selectionItemId == null ? null : String(selectionItemId).trim(),
    comparisonPairId: comparisonPairId == null ? null : String(comparisonPairId).trim(),
    observationId: observationId == null ? null : String(observationId).trim(),
    securityId,
    ticker: securityId,
    agentId: strata.agentId,
  };
}

function assertRecordIdentity(record, path, expected, label = "outcome security") {
  if (record == null) return;
  for (const key of ["securityId", "ticker"]) {
    if (record[key] != null && String(record[key]).trim().toUpperCase() !== expected.toUpperCase()) {
      throw new TypeError(`${path}.${key} does not match ${label} identity`);
    }
  }
}

function validateFuture(record, path, asOfMs, names) {
  const at = recordTime(record, path, names);
  if (at != null && timestamp(at, path) > asOfMs) {
    throw new RangeError(`${path} is after asOf`);
  }
  return at;
}

function normalizeCosts(costInput, grossReturn) {
  if (costInput == null) {
    return {
      policyVersion: null,
      baseNetReturn: null,
      stressedNetReturn: null,
      baseCosts: null,
      stressedCosts: null,
    };
  }
  if (typeof costInput !== "object" || Array.isArray(costInput)) {
    throw new TypeError("costs must be a versioned object");
  }
  const policyVersion = requiredString(costInput.version ?? costInput.policyVersion, "costs.version");
  const result = {
    policyVersion,
    baseNetReturn: null,
    stressedNetReturn: null,
    baseCosts: null,
    stressedCosts: null,
  };

  for (const scenario of ["base", "stressed"]) {
    const supplied = costInput[scenario];
    const netKey = `${scenario}NetReturn`;
    const explicitNet = costInput[netKey] ?? costInput.netReturns?.[scenario];
    if (explicitNet != null) result[netKey] = finite(explicitNet, `costs.${netKey}`);
    if (supplied == null) continue;
    if (typeof supplied !== "object" || Array.isArray(supplied)) throw new TypeError(`costs.${scenario} must be an object`);
    const entryCostRate = supplied.entryCostRate == null ? null : finite(supplied.entryCostRate, `costs.${scenario}.entryCostRate`);
    const exitCostRate = supplied.exitCostRate == null ? null : finite(supplied.exitCostRate, `costs.${scenario}.exitCostRate`);
    if ((entryCostRate == null) !== (exitCostRate == null)) {
      throw new TypeError(`costs.${scenario} requires both entryCostRate and exitCostRate`);
    }
    if (entryCostRate != null) {
      result[`${scenario}Costs`] = { entryCostRate, exitCostRate };
      if (grossReturn != null) {
        const recomputed = applyTransactionCosts({ grossReturn, entryCostRate, exitCostRate });
        if (result[netKey] != null && Math.abs(result[netKey] - recomputed) > 1e-9) {
          throw new TypeError(`costs.${netKey} diverges from supplied rates`);
        }
        result[netKey] = recomputed;
      }
    }
  }
  return result;
}

function hitEvaluator(policy) {
  if (policy == null) return null;
  const evaluate = policy.evaluate ?? policy.classify ?? policy.isHit;
  if (typeof evaluate !== "function") throw new TypeError("hitPolicy requires an evaluate function");
  return evaluate;
}

function pathForRisk(path, asOfMs, entryAt, exitAt, securityId) {
  if (path == null) return [];
  if (!Array.isArray(path)) throw new TypeError("securityPath must be an array");
  const normalized = path.map((record, index) => {
    if (record == null || typeof record !== "object") throw new TypeError(`securityPath[${index}] must be an object`);
    const at = recordTime(record, `securityPath[${index}]`, ["completedAt", "timestamp"]);
    if (at == null) throw new TypeError(`securityPath[${index}] requires completedAt or timestamp`);
    assertRecordIdentity(record, `securityPath[${index}]`, securityId);
    if (at != null && timestamp(at, `securityPath[${index}]`) > asOfMs) {
      throw new RangeError(`securityPath[${index}] is after asOf`);
    }
    if (entryAt != null && timestamp(at, `securityPath[${index}]`) < timestamp(entryAt, "entryAt")) {
      throw new RangeError(`securityPath[${index}] is before entryAt`);
    }
    if (at != null && exitAt != null && timestamp(at, `securityPath[${index}]`) > timestamp(exitAt, "exitAt")) {
      throw new RangeError(`securityPath[${index}] is after exitAt`);
    }
    positiveRecordValue(record, `securityPath[${index}]`);
    return { record, at, sortId: String(record.id ?? "") };
  });
  return normalized.sort((left, right) => timestamp(left.at, "securityPath.at") - timestamp(right.at, "securityPath.at") ||
    left.sortId.localeCompare(right.sortId) || canonicalJson(left.record).localeCompare(canonicalJson(right.record))).map(({ record }) => record);
}

function buildCanonicalPayload(result) {
  const { canonicalPayload: ignored, outcomeHash: ignoredHash, hash: ignoredAlias, ...payload } = result;
  return payload;
}

/**
 * Classify one injected forward outcome. This function has no adapters or
 * side effects: callers own acquisition, persistence, and policy functions.
 */
export function classifyResearchOutcome(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("outcome input must be an object");
  const entry = input.securityEntry ?? input.entry ?? null;
  const securityExit = input.securityExit ?? input.exit ?? null;
  const benchmarkEntry = input.benchmarkEntry ?? null;
  const benchmarkExit = input.benchmarkExit ?? null;
  const asOf = iso(input.asOf, "asOf");
  const asOfMs = timestamp(asOf, "asOf");
  const horizon = versionedPolicy(input.horizonPolicy ?? input.horizon, "horizonPolicy");
  const benchmark = versionedPolicy(input.benchmarkPolicy ?? input.benchmark, "benchmarkPolicy");
  const hitPolicy = versionedPolicy(input.hitPolicy, "hitPolicy", false);
  const evidenceClass = requiredString(input.evidenceClass, "evidenceClass");
  if (!EVIDENCE_CLASSES.has(evidenceClass)) throw new TypeError("evidenceClass is unsupported");
  const hit = hitEvaluator(hitPolicy?.policy);
  const horizonDays = finite(horizon.policy.horizonDays ?? horizon.policy.days, "horizonPolicy.horizonDays");
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) throw new TypeError("horizonPolicy.horizonDays must be a positive integer");
  const observationToleranceMs = finite(horizon.policy.observationToleranceMs, "horizonPolicy.observationToleranceMs");
  if (!Number.isInteger(observationToleranceMs) || observationToleranceMs < 0) throw new TypeError("horizonPolicy.observationToleranceMs must be a nonnegative integer");
  const benchmarkAlignmentToleranceMs = finite(benchmark.policy.alignmentToleranceMs, "benchmarkPolicy.alignmentToleranceMs");
  if (!Number.isInteger(benchmarkAlignmentToleranceMs) || benchmarkAlignmentToleranceMs < 0) throw new TypeError("benchmarkPolicy.alignmentToleranceMs must be a nonnegative integer");
  const configuredBenchmarkId = benchmarkId(benchmark.policy);
  if (!configuredBenchmarkId) {
    throw new TypeError("benchmarkPolicy requires benchmarkSecurityId");
  }
  const strata = strataFor(input);
  const identity = identityFor(input, entry, strata);
  assertRecordIdentity(securityExit, "securityExit", identity.securityId);
  assertRecordIdentity(benchmarkEntry, "benchmarkEntry", configuredBenchmarkId, "benchmarkPolicy/benchmark");
  assertRecordIdentity(benchmarkExit, "benchmarkExit", configuredBenchmarkId, "benchmarkPolicy/benchmark");
  const policyVersions = {
    horizon: horizon.version,
    benchmark: benchmark.version,
    hit: hitPolicy?.version ?? null,
    // Cost policy is decision-time lineage even before the horizon matures.
    // Carry its version on immature/unavailable snapshots so maturation does
    // not manufacture a second sample identity merely because metrics arrived.
    cost: normalizeCosts(input.costs ?? input.costOutputs ?? input.costPolicyOutputs ?? null, null).policyVersion,
  };

  let entryAt = entry?.executableAt == null ? null : iso(entry.executableAt, "securityEntry.executableAt");
  if (entryAt == null && !input.excluded && input.eligible !== false) {
    throw new TypeError("securityEntry.executableAt is required");
  }
  if (entryAt != null && timestamp(entryAt, "securityEntry.executableAt") > asOfMs) {
    throw new RangeError("securityEntry.executableAt is after asOf");
  }
  if (input.decisionAt != null && entryAt != null && timestamp(entryAt, "securityEntry.executableAt") <= timestamp(input.decisionAt, "decisionAt")) {
    throw new RangeError("securityEntry.executableAt must be after decisionAt; same-session execution is not allowed");
  }
  const targetAt = entryAt == null ? null : new Date(timestamp(entryAt, "securityEntry.executableAt") + (horizonDays * DAY_MS)).toISOString();
  const excluded = input.excluded === true || input.eligible === false;
  const base = {
    schemaVersion: "research-outcome-v1",
    evidenceClass,
    status: excluded ? "excluded" : null,
    reason: excluded ? String(input.exclusionReason ?? input.reason ?? "excluded_by_caller") : null,
    asOf,
    entryAt,
    targetAt,
    exitAt: null,
    identity,
    strata,
    policyVersions,
    timingRules: { horizonDays, observationToleranceMs, benchmarkAlignmentToleranceMs },
    metrics: null,
    hit: null,
  };

  // Validate supplied observations before the maturity branch so future data
  // cannot be hidden behind an otherwise legitimate immature status.
  const suppliedSecurityExitAt = validateFuture(securityExit, "securityExit", asOfMs, ["completedAt", "timestamp"]);
  const suppliedBenchmarkEntryAt = validateFuture(benchmarkEntry, "benchmarkEntry", asOfMs, ["completedAt", "timestamp"]);
  const suppliedBenchmarkExitAt = validateFuture(benchmarkExit, "benchmarkExit", asOfMs, ["completedAt", "timestamp"]);
  if (!excluded) {
    positiveRecordValue(entry, "securityEntry");
    positiveRecordValue(securityExit, "securityExit");
    positiveRecordValue(benchmarkEntry, "benchmarkEntry");
    positiveRecordValue(benchmarkExit, "benchmarkExit");
    pathForRisk(input.securityPath ?? input.pricePath ?? [], asOfMs, entryAt, suppliedSecurityExitAt, identity.securityId);
  }

  function finalize(result) {
    if (!STATUSES.has(result.status)) throw new TypeError(`unsupported outcome status: ${result.status}`);
    const canonicalPayload = buildCanonicalPayload(result);
    const outcomeHash = contentHash(canonicalPayload);
    return { ...result, canonicalPayload, outcomeHash, hash: outcomeHash };
  }

  if (excluded) return finalize(base);
  if (timestamp(asOf, "asOf") < timestamp(targetAt, "targetAt")) {
    return finalize({ ...base, status: "immature", reason: "horizon_not_mature" });
  }

  const securityEntryValue = positiveRecordValue(entry, "securityEntry");
  if (securityEntryValue == null) return finalize({ ...base, status: "unavailable", reason: "missing_security_entry_price" });
  const securityExitAt = suppliedSecurityExitAt;
  const securityExitValue = positiveRecordValue(securityExit, "securityExit");
  if (securityExitValue == null || securityExitAt == null) {
    return finalize({ ...base, status: "unavailable", reason: "missing_security_horizon_price" });
  }
  if (timestamp(securityExitAt, "securityExit") < timestamp(targetAt, "targetAt")) {
    return finalize({ ...base, status: "unavailable", reason: "security_price_before_horizon" });
  }
  if (timestamp(securityExitAt, "securityExit") - timestamp(targetAt, "targetAt") > observationToleranceMs) {
    return finalize({ ...base, status: "unavailable", reason: "security_price_not_aligned_to_horizon" });
  }

  let benchmarkEntryAt = null;
  let benchmarkExitAt = null;
  if (configuredBenchmarkId) {
    benchmarkEntryAt = suppliedBenchmarkEntryAt;
    benchmarkExitAt = suppliedBenchmarkExitAt;
    if (positiveRecordValue(benchmarkEntry, "benchmarkEntry") == null || positiveRecordValue(benchmarkExit, "benchmarkExit") == null ||
      benchmarkEntryAt == null || benchmarkExitAt == null) {
      return finalize({ ...base, status: "unavailable", reason: "missing_benchmark_price" });
    }
    if (Math.abs(timestamp(benchmarkEntryAt, "benchmarkEntry") - timestamp(entryAt, "entryAt")) > benchmarkAlignmentToleranceMs ||
      Math.abs(timestamp(benchmarkExitAt, "benchmarkExit") - timestamp(securityExitAt, "securityExit")) > benchmarkAlignmentToleranceMs) {
      return finalize({ ...base, status: "unavailable", reason: "benchmark_price_not_aligned" });
    }
  }

  const securityPath = pathForRisk(input.securityPath ?? input.pricePath ?? [], asOfMs, entryAt, securityExitAt, identity.securityId);
  const grossMetrics = computeForwardMetrics({
    securityEntry: entry,
    securityExit,
    benchmarkEntry: configuredBenchmarkId ? benchmarkEntry : null,
    benchmarkExit: configuredBenchmarkId ? benchmarkExit : null,
    pricePath: securityPath.length ? securityPath : [securityExit],
  });
  const costs = normalizeCosts(input.costs ?? input.costOutputs ?? input.costPolicyOutputs ?? null, grossMetrics.forwardTotalReturn);
  const metrics = {
    ...grossMetrics,
    baseNetReturn: costs.baseNetReturn,
    stressedNetReturn: costs.stressedNetReturn,
    baseCosts: costs.baseCosts,
    stressedCosts: costs.stressedCosts,
    benchmarkSecurityId: configuredBenchmarkId ?? null,
    benchmarkEntryAt,
    benchmarkExitAt,
    turnover: input.turnover == null ? null : finite(input.turnover, "turnover"),
  };
  if (metrics.turnover != null && metrics.turnover < 0) throw new RangeError("turnover must be nonnegative");
  let hitValue = null;
  if (hit) {
    const evaluated = hit({ metrics, input, status: "matured", entry, securityExit, benchmarkEntry, benchmarkExit });
    if (typeof evaluated !== "boolean") throw new TypeError("hitPolicy evaluate must return a boolean");
    hitValue = evaluated;
  }
  return finalize({
    ...base,
    status: "matured",
    reason: null,
    exitAt: securityExitAt,
    policyVersions,
    metrics,
    hit: hitValue,
  });
}

export const computeResearchOutcome = classifyResearchOutcome;
export const classifyOutcome = classifyResearchOutcome;
export const outcomeHash = (outcome) => contentHash(buildCanonicalPayload(outcome));
export const canonicalOutcome = (outcome) => canonicalJson(buildCanonicalPayload(outcome));

export default classifyResearchOutcome;
