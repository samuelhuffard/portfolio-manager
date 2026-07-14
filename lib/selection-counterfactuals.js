import { canonicalJson, contentHash } from "./research-version.js";

export const COMPARISON_TYPES = Object.freeze([
  "event_vs_rotation",
  "top_score_vs_exploration",
  "ai_vs_finalist",
  "evaluator_disposition",
]);

const COMPARISON_TYPE_SET = new Set(COMPARISON_TYPES);
const EXCLUDED_SELECTIONS = new Set(["holding", "mandatory_review", "mandatory_reunderwrite", "mandatory_re-underwrite"]);
const STRATUM_FIELDS = [
  "agentId",
  "horizonPolicyVersion",
  "benchmarkPolicyVersion",
  "hitPolicyVersion",
  "costPolicyVersion",
  "evidenceClass",
  "mandateVersion",
  "scoringVersion",
  "scoreCompleteness",
  "deltaCause",
];

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function finite(value, path) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${path} requires a finite number`);
  return number;
}

function round(value) {
  return value == null ? null : Number(value.toFixed(12));
}

function average(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function outcomeOf(row) {
  return row?.outcome && typeof row.outcome === "object" ? row.outcome : row;
}

function policyVersionsFor(row) {
  const outcome = outcomeOf(row);
  const policyVersions = outcome?.policyVersions ?? row?.policyVersions ?? {};
  const strata = outcome?.strata ?? row?.strata ?? {};
  return {
    agentId: outcome?.agentId ?? strata.agentId ?? row?.agentId ?? null,
    horizonPolicyVersion: outcome?.horizonPolicyVersion ?? policyVersions.horizon ?? row?.horizonPolicyVersion ?? null,
    benchmarkPolicyVersion: outcome?.benchmarkPolicyVersion ?? policyVersions.benchmark ?? row?.benchmarkPolicyVersion ?? null,
    hitPolicyVersion: outcome?.hitPolicyVersion ?? policyVersions.hit ?? row?.hitPolicyVersion ?? null,
    costPolicyVersion: outcome?.costPolicyVersion ?? policyVersions.cost ?? row?.costPolicyVersion ?? null,
    evidenceClass: outcome?.evidenceClass ?? row?.evidenceClass ?? null,
    mandateVersion: outcome?.mandateVersion ?? strata.mandateVersion ?? row?.mandateVersion ?? null,
    scoringVersion: outcome?.scoringVersion ?? strata.scoringVersion ?? row?.scoringVersion ?? row?.scoringConfigVersion ?? null,
    scoreCompleteness: outcome?.scoreCompleteness ?? outcome?.completeness ?? strata.scoreCompleteness ?? strata.completeness ??
      row?.scoreCompleteness ?? row?.completeness ?? null,
    deltaCause: outcome?.deltaCause ?? strata.deltaCause ?? row?.deltaCause ?? null,
  };
}

export function comparisonPairIdFor({ selectionRunId, agentId, selectedTicker, displacedTicker } = {}) {
  const identity = {
    selectionRunId: String(selectionRunId ?? "").trim(),
    agentId: String(agentId ?? "").trim(),
    selectedTicker: String(selectedTicker ?? "").trim().toUpperCase(),
    displacedTicker: String(displacedTicker ?? "").trim().toUpperCase(),
  };
  if (Object.values(identity).some((value) => !value)) {
    throw new TypeError("comparison pair requires selectionRunId, agentId, selectedTicker, and displacedTicker");
  }
  return `comparison-${contentHash(identity)}`;
}

function identityFor(row, index, side) {
  const outcome = outcomeOf(row);
  const lineage = row?.lineage ?? outcome?.lineage ?? {};
  const comparisonPairId = row?.comparisonPairId ?? outcome?.comparisonPairId ?? lineage.comparisonPairId ?? null;
  const selectionRunId = row?.selectionRunId ?? outcome?.selectionRunId ?? lineage.selectionRunId ?? lineage.runId ?? null;
  const selectionItemId = row?.selectionItemId ?? row?.itemId ?? outcome?.selectionItemId ?? outcome?.itemId ?? lineage.selectionItemId ?? lineage.itemId ?? null;
  const agentId = outcome?.agentId ?? outcome?.strata?.agentId ?? row?.agentId ?? row?.strata?.agentId ?? null;
  const ticker = row?.ticker ?? row?.securityId ?? outcome?.ticker ?? outcome?.securityId ?? null;
  const selectedTicker = row?.selectedTicker ?? row?.selectedSecurityId ?? outcome?.selectedTicker ?? outcome?.selectedSecurityId ??
    (side === "selected" ? ticker : null);
  const displacedTicker = row?.displacedTicker ?? row?.comparedTicker ?? outcome?.displacedTicker ?? outcome?.comparedTicker ??
    (side === "displaced" ? ticker : null);
  if (selectionRunId == null || selectionItemId == null || agentId == null || !selectedTicker || !displacedTicker) {
    throw new TypeError(`${side}[${index}] requires complete E3/E4 selection lineage`);
  }
  const normalized = {
    comparisonPairId: comparisonPairId == null ? null : String(comparisonPairId),
    selectionRunId: selectionRunId == null ? null : String(selectionRunId),
    selectionItemId: selectionItemId == null ? null : String(selectionItemId),
    agentId: agentId == null ? null : String(agentId),
    selectedTicker: selectedTicker == null ? null : String(selectedTicker).trim().toUpperCase(),
    displacedTicker: displacedTicker == null ? null : String(displacedTicker).trim().toUpperCase(),
  };
  const deterministicId = comparisonPairIdFor(normalized);
  if (normalized.comparisonPairId != null && normalized.comparisonPairId !== deterministicId) {
    throw new TypeError(`${side}[${index}].comparisonPairId does not match deterministic selection lineage`);
  }
  normalized.comparisonPairId = deterministicId;
  const sideTicker = String(ticker ?? "").trim().toUpperCase();
  const expectedTicker = side === "selected" ? normalized.selectedTicker : normalized.displacedTicker;
  if (sideTicker && sideTicker !== expectedTicker) throw new TypeError(`${side}[${index}].ticker does not match pair lineage`);
  const key = `pair:${deterministicId}`;
  return { key, normalized };
}

function statusFor(row) {
  return outcomeOf(row)?.status ?? row?.status ?? null;
}

function isExcluded(row) {
  const outcome = outcomeOf(row);
  const selection = row?.selectionCategory ?? row?.selectionRole ?? outcome?.selectionCategory ?? outcome?.selectionRole ?? null;
  const bucket = row?.bucket ?? outcome?.bucket ?? null;
  return statusFor(row) === "excluded" || row?.isHolding === true || row?.mandatoryReunderwrite === true ||
    row?.budgetExempt === true || outcome?.budgetExempt === true || EXCLUDED_SELECTIONS.has(String(selection ?? "").toLowerCase()) ||
    ["holding", "mandatory_reunderwrite"].includes(String(bucket ?? "").toLowerCase());
}

function metricsFor(row) {
  return outcomeOf(row)?.metrics ?? row?.metrics ?? null;
}

function normalizeRows(rows, side) {
  const map = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError(`${side}[${index}] must be an object`);
    const identity = identityFor(row, index, side);
    const prior = map.get(identity.key);
    if (prior) {
      if (canonicalJson(prior.identity.normalized) !== canonicalJson(identity.normalized)) {
        throw new TypeError(`divergent ${side} lineage identity for ${identity.key}`);
      }
      throw new TypeError(`duplicate ${side} lineage identity for ${identity.key}`);
    }
    map.set(identity.key, { row, identity });
  }
  return map;
}

function assertPairLineage(selected, displaced, key) {
  for (const field of ["selectionRunId", "agentId", "selectedTicker", "displacedTicker"]) {
    const left = selected.identity.normalized[field];
    const right = displaced.identity.normalized[field];
    if (left != null && right != null && left !== right) {
      throw new TypeError(`divergent ${field} for comparison pair ${key}`);
    }
  }
}

function stratumFor(selected, displaced) {
  const left = policyVersionsFor(selected);
  const right = policyVersionsFor(displaced);
  const same = STRATUM_FIELDS.every((field) => left[field] === right[field]);
  const required = ["agentId", "horizonPolicyVersion", "benchmarkPolicyVersion", "evidenceClass", "mandateVersion", "scoringVersion", "scoreCompleteness"];
  const complete = required.every((field) => left[field] != null && right[field] != null);
  return {
    same,
    complete,
    selected: left,
    displaced: right,
    label: left,
    stratumId: contentHash(left),
  };
}

function makePair(key, selected, displaced, stratum) {
  const selectedMetrics = metricsFor(selected);
  const displacedMetrics = metricsFor(displaced);
  const selectedTotalReturn = finite(selectedMetrics?.forwardTotalReturn, `${key}.selected.forwardTotalReturn`);
  const displacedTotalReturn = finite(displacedMetrics?.forwardTotalReturn, `${key}.displaced.forwardTotalReturn`);
  const selectedExcessReturn = finite(selectedMetrics?.forwardExcessReturn, `${key}.selected.forwardExcessReturn`);
  const displacedExcessReturn = finite(displacedMetrics?.forwardExcessReturn, `${key}.displaced.forwardExcessReturn`);
  if (selectedTotalReturn == null || displacedTotalReturn == null) return null;
  return {
    comparisonPairId: key.replace(/^pair:/, ""),
    selectedTotalReturn,
    displacedTotalReturn,
    selectedExcessReturn,
    displacedExcessReturn,
    selectedMinusDisplacedTotalReturn: round(selectedTotalReturn - displacedTotalReturn),
    displacedMinusSelectedTotalReturn: round(displacedTotalReturn - selectedTotalReturn),
    selectedMinusDisplacedExcessReturn: selectedExcessReturn == null || displacedExcessReturn == null ? null : round(selectedExcessReturn - displacedExcessReturn),
    displacedMinusSelectedExcessReturn: selectedExcessReturn == null || displacedExcessReturn == null ? null : round(displacedExcessReturn - selectedExcessReturn),
    stratumId: stratum.stratumId,
  };
}

function aggregatePairs(pairs) {
  if (!pairs.length) {
    return {
      sampleCount: 0,
      selectedAverageTotalReturn: null,
      displacedAverageTotalReturn: null,
      selectedMinusDisplacedTotalReturn: null,
      displacedMinusSelectedTotalReturn: null,
      selectedAverageExcessReturn: null,
      displacedAverageExcessReturn: null,
      selectedMinusDisplacedExcessReturn: null,
      displacedMinusSelectedExcessReturn: null,
      opportunityCostTotalReturn: null,
      opportunityCostExcessReturn: null,
    };
  }
  const excessComplete = pairs.every((pair) => pair.selectedExcessReturn != null && pair.displacedExcessReturn != null);
  return {
    sampleCount: pairs.length,
    selectedAverageTotalReturn: average(pairs.map((pair) => pair.selectedTotalReturn)),
    displacedAverageTotalReturn: average(pairs.map((pair) => pair.displacedTotalReturn)),
    selectedMinusDisplacedTotalReturn: average(pairs.map((pair) => pair.selectedMinusDisplacedTotalReturn)),
    displacedMinusSelectedTotalReturn: average(pairs.map((pair) => pair.displacedMinusSelectedTotalReturn)),
    selectedAverageExcessReturn: excessComplete ? average(pairs.map((pair) => pair.selectedExcessReturn)) : null,
    displacedAverageExcessReturn: excessComplete ? average(pairs.map((pair) => pair.displacedExcessReturn)) : null,
    selectedMinusDisplacedExcessReturn: excessComplete ? average(pairs.map((pair) => pair.selectedMinusDisplacedExcessReturn)) : null,
    displacedMinusSelectedExcessReturn: excessComplete ? average(pairs.map((pair) => pair.displacedMinusSelectedExcessReturn)) : null,
    opportunityCostTotalReturn: average(pairs.map((pair) => pair.displacedMinusSelectedTotalReturn)),
    opportunityCostExcessReturn: excessComplete ? average(pairs.map((pair) => pair.displacedMinusSelectedExcessReturn)) : null,
  };
}

function emptyAggregate() {
  return aggregatePairs([]);
}

function splitRecords(input) {
  if (input.selected != null || input.displaced != null || input.selectedOutcomes != null || input.displacedOutcomes != null) {
    return {
      selected: input.selected ?? input.selectedOutcomes ?? [],
      displaced: input.displaced ?? input.displacedOutcomes ?? [],
    };
  }
  const records = requiredArray(input.records ?? input.outcomes, "records");
  return {
    selected: records.filter((row) => ["selected", "kept", "chosen"].includes(String(row.side ?? row.role ?? "").toLowerCase())),
    displaced: records.filter((row) => ["displaced", "rejected", "alternative"].includes(String(row.side ?? row.role ?? "").toLowerCase())),
  };
}

/** Pure, labeled comparison of paired matured outcome records. */
export function compareSelectionCounterfactuals(input = {}) {
  const comparisonType = String(input.comparisonType ?? "").trim();
  if (!COMPARISON_TYPE_SET.has(comparisonType)) {
    throw new TypeError(`comparisonType must be one of: ${COMPARISON_TYPES.join(", ")}`);
  }
  const { selected, displaced } = splitRecords(input);
  const selectedMap = normalizeRows(requiredArray(selected, "selected"), "selected");
  const displacedMap = normalizeRows(requiredArray(displaced, "displaced"), "displaced");
  const keys = [...new Set([...selectedMap.keys(), ...displacedMap.keys()])].sort();
  const strataMap = new Map();
  const missing = { selected: 0, displaced: 0, pairs: 0 };
  const excluded = { selected: 0, displaced: 0, pairs: 0 };
  let immature = 0;
  let unavailable = 0;
  let versionMismatch = 0;
  let insufficient = 0;
  const versionMismatchStrata = [];

  for (const key of keys) {
    const left = selectedMap.get(key)?.row ?? null;
    const right = displacedMap.get(key)?.row ?? null;
    if (!left) { missing.selected++; missing.pairs++; }
    if (!right) { missing.displaced++; missing.pairs++; }
    if (!left || !right) continue;
    assertPairLineage(selectedMap.get(key), displacedMap.get(key), key);
    if (isExcluded(left)) excluded.selected++;
    if (isExcluded(right)) excluded.displaced++;
    if (isExcluded(left) || isExcluded(right)) { excluded.pairs++; continue; }
    const statuses = [statusFor(left), statusFor(right)];
    if (statuses.includes("immature")) immature += statuses.filter((status) => status === "immature").length;
    if (statuses.includes("unavailable")) unavailable += statuses.filter((status) => status === "unavailable").length;
    if (statuses.some((status) => status !== "matured")) { missing.pairs++; continue; }
    const stratum = stratumFor(left, right);
    if (!stratum.same) {
      versionMismatch++;
      insufficient++;
      versionMismatchStrata.push({
        comparisonPairId: selectedMap.get(key).identity.normalized.comparisonPairId,
        reason: "version_strata_mismatch",
        selected: stratum.selected,
        displaced: stratum.displaced,
        selectedStratumId: contentHash(stratum.selected),
        displacedStratumId: contentHash(stratum.displaced),
      });
      continue;
    }
    if (!stratum.complete) { insufficient++; missing.pairs++; continue; }
    const pair = makePair(key, left, right, stratum);
    if (!pair) { insufficient++; missing.pairs++; continue; }
    const bucket = strataMap.get(stratum.stratumId) ?? { stratumId: stratum.stratumId, labels: stratum.label, pairs: [] };
    bucket.pairs.push(pair);
    strataMap.set(stratum.stratumId, bucket);
  }

  const strata = [...strataMap.values()].sort((left, right) => left.stratumId.localeCompare(right.stratumId)).map((stratum) => ({
    ...stratum,
    aggregate: aggregatePairs(stratum.pairs),
  }));
  const aggregate = strata.length === 1 ? strata[0].aggregate : emptyAggregate();
  const comparableSampleCount = strata.reduce((sum, stratum) => sum + stratum.pairs.length, 0);
  const result = {
    schemaVersion: "selection-counterfactuals-v1",
    comparisonType,
    sampleCount: comparableSampleCount,
    counts: {
      selected: selectedMap.size,
      displaced: displacedMap.size,
      paired: keys.filter((key) => selectedMap.has(key) && displacedMap.has(key)).length,
      comparable: comparableSampleCount,
      missing: missing.selected + missing.displaced,
      immature,
      unavailable,
      excluded: excluded.selected + excluded.displaced,
      versionMismatch,
      insufficient,
      missingBySide: missing,
      excludedBySide: excluded,
    },
    missingCount: missing.selected + missing.displaced,
    excludedCount: excluded.selected + excluded.displaced,
    aggregate,
    strata,
    versionMismatchStrata: versionMismatchStrata.sort((left, right) => left.comparisonPairId.localeCompare(right.comparisonPairId)),
    incomparablePairs: versionMismatchStrata,
    pairs: strata.flatMap((stratum) => stratum.pairs),
  };
  return { ...result, canonicalPayload: result, resultHash: contentHash(result) };
}

export const selectionCounterfactuals = compareSelectionCounterfactuals;
export const compareCounterfactuals = compareSelectionCounterfactuals;

export default compareSelectionCounterfactuals;
