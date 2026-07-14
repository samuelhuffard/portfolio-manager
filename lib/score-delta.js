import { MandateScoreObservationSchema } from "../contracts/research-observation.js";

const ECONOMIC_CAUSES = new Set(["filing", "market", "estimate", "ownership"]);
const CAUSE_PRIORITY = [
  "version",
  "coverage",
  "restatement",
  "filing",
  "estimate",
  "ownership",
  "peer_set",
  "market",
  "retry",
  "initial",
];

const TRANSPORT_OBSERVATION_FIELDS = new Set(["id", "runId", "observedAt", "scoreCause"]);
const TRANSPORT_METRIC_FIELDS = new Set(["retrievedAt"]);
const METRIC_VALUE_FIELDS = [
  "value",
  "points",
  "sourceDocumentId",
  "sourceFiledAt",
  "sourceAsOf",
  "freshnessState",
  "calculationMethod",
];

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(sortedKeys(value).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sameContent(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function observationContent(observation) {
  return Object.fromEntries(
    sortedKeys(observation)
      .filter((key) => !TRANSPORT_OBSERVATION_FIELDS.has(key))
      .map((key) => {
        if (key !== "metrics") return [key, observation[key]];
        return [
          key,
          observation.metrics.map((metric) =>
            Object.fromEntries(
              sortedKeys(metric)
                .filter((metricKey) => !TRANSPORT_METRIC_FIELDS.has(metricKey))
                .map((metricKey) => [metricKey, metric[metricKey]]),
            ),
          ),
        ];
      }),
  );
}

function metricContent(metric) {
  return Object.fromEntries(
    sortedKeys(metric)
      .filter((key) => !TRANSPORT_METRIC_FIELDS.has(key))
      .map((key) => [key, metric[key]]),
  );
}

function metricChange(previousMetric, currentMetric) {
  if (!previousMetric || !currentMetric) return true;
  return !sameContent(metricContent(previousMetric), metricContent(currentMetric));
}

function metricCategory(metric) {
  const haystack = `${metric.metricId} ${metric.source} ${metric.calculationMethod}`.toLowerCase();
  if (/(estimate|consensus|analyst|target)/.test(haystack)) return "estimate";
  if (/(ownership|insider|institutional|13f|form.?4)/.test(haystack)) return "ownership";
  if (/(price|valuation|multiple|p\/e|pe_ratio|p\/b|pb_ratio|enterprise.?value|ev\/|yield|momentum|volatility|beta|relative.?volume)/.test(haystack)) {
    return "market";
  }
  return "fundamental";
}

function isLaterTimestamp(currentValue, previousValue) {
  if (!currentValue || currentValue === previousValue) return false;
  if (!previousValue) return true;
  const currentMs = Date.parse(currentValue);
  const previousMs = Date.parse(previousValue);
  return Number.isFinite(currentMs) && Number.isFinite(previousMs) && currentMs > previousMs;
}

function isCovered(metric) {
  return Boolean(metric) && metric.points !== null && metric.value !== null &&
    !["unavailable", "unsupported"].includes(metric.freshnessState);
}

function changedFundamentalInput(previousMetric, currentMetric) {
  return METRIC_VALUE_FIELDS.some((field) => previousMetric?.[field] !== currentMetric?.[field]) &&
    ["value", "points", "sourceDocumentId", "freshnessState", "calculationMethod"].some(
      (field) => previousMetric?.[field] !== currentMetric?.[field],
    );
}

function validatePolicy(materialityPolicy) {
  if (materialityPolicy == null) return null;
  if (typeof materialityPolicy === "function") {
    const version = String(materialityPolicy.version ?? "").trim();
    if (!version) throw new TypeError("materialityPolicy function requires a nonempty version");
    return { version, evaluate: materialityPolicy };
  }
  if (typeof materialityPolicy !== "object") {
    throw new TypeError("materialityPolicy must be a versioned object");
  }
  const version = String(materialityPolicy.version ?? "").trim();
  const evaluate = materialityPolicy.evaluate ?? materialityPolicy.isMaterial ?? materialityPolicy.classify;
  if (!version || typeof evaluate !== "function") {
    throw new TypeError("materialityPolicy requires a nonempty version and evaluate function");
  }
  return { version, evaluate };
}

function normalizeArguments(input, maybeCurrent, maybePolicy, argumentCount) {
  if (argumentCount > 1 || input === null || (input && !Object.hasOwn(input, "current"))) {
    return { previous: input, current: maybeCurrent, materialityPolicy: maybePolicy };
  }
  if (!input || typeof input !== "object") {
    throw new TypeError("classifyScoreDelta requires an input object");
  }
  return {
    previous: input.previous ?? input.previousObservation ?? null,
    current: input.current ?? input.currentObservation,
    materialityPolicy: input.materialityPolicy ?? input.materiality ?? input.policy ?? null,
  };
}

function validateComparableSeries(previous, current) {
  for (const field of ["ticker", "agentId", "mandateId"]) {
    if (previous[field] !== current[field]) {
      throw new TypeError(`observations must share ${field}`);
    }
  }
}

function buildMetricChanges(previous, current) {
  const previousById = new Map(previous.metrics.map((metric) => [metric.metricId, metric]));
  const currentById = new Map(current.metrics.map((metric) => [metric.metricId, metric]));
  const metricIds = [...new Set([...previousById.keys(), ...currentById.keys()])].sort();
  return metricIds
    .filter((metricId) => metricChange(previousById.get(metricId), currentById.get(metricId)))
    .map((metricId) => ({
      metricId,
      previous: previousById.get(metricId),
      current: currentById.get(metricId),
    }));
}

function comparabilityChanges(previous, current, metricChanges) {
  const incomparableMetricIds = new Set();
  const previousById = new Map(previous.metrics.map((metric) => [metric.metricId, metric]));
  const currentById = new Map(current.metrics.map((metric) => [metric.metricId, metric]));
  for (const { metricId } of metricChanges) {
    const oldMetric = previousById.get(metricId);
    const newMetric = currentById.get(metricId);
    if (oldMetric && newMetric && (oldMetric.unit !== newMetric.unit || oldMetric.calculationMethod !== newMetric.calculationMethod)) {
      incomparableMetricIds.add(metricId);
    }
  }
  return {
    incomparableMetricIds,
    specialSectorChanged: previous.specialSectorKey !== current.specialSectorKey,
  };
}

function changedCauseSet({ metricChanges, incomparableMetricIds, coverageChanged, peerSetChanged, versionChanged }) {
  const causes = new Set();
  if (versionChanged) causes.add("version");
  if (coverageChanged) causes.add("coverage");
  const comparableMetricChanges = metricChanges.filter(({ metricId }) => !incomparableMetricIds.has(metricId));

  const filingChanged = comparableMetricChanges.some(({ previous: oldMetric, current: newMetric }) => {
    if (!newMetric || metricCategory(newMetric) !== "fundamental") return false;
    const hasNewFilingDate = isLaterTimestamp(newMetric.sourceFiledAt, oldMetric?.sourceFiledAt) ||
      isLaterTimestamp(newMetric.sourceAsOf, oldMetric?.sourceAsOf);
    return hasNewFilingDate && changedFundamentalInput(oldMetric, newMetric);
  });
  if (filingChanged) causes.add("filing");

  if (comparableMetricChanges.some(({ current: metric }) => metric && metricCategory(metric) === "estimate")) causes.add("estimate");
  if (comparableMetricChanges.some(({ current: metric }) => metric && metricCategory(metric) === "ownership")) causes.add("ownership");
  if (comparableMetricChanges.some(({ current: metric }) => metric && metricCategory(metric) === "market")) causes.add("market");
  if (peerSetChanged) causes.add("peer_set");

  const hasUnclassifiedFundamentalChange = comparableMetricChanges.some(({ previous: oldMetric, current: newMetric }) => {
    const metric = newMetric ?? oldMetric;
    if (isCovered(oldMetric) !== isCovered(newMetric)) return false;
    const hasNewFilingDate = newMetric && (
      isLaterTimestamp(newMetric.sourceFiledAt, oldMetric?.sourceFiledAt) ||
      isLaterTimestamp(newMetric.sourceAsOf, oldMetric?.sourceAsOf)
    );
    return metricCategory(metric) === "fundamental" && !(
      newMetric && metricCategory(newMetric) === "fundamental" &&
      hasNewFilingDate &&
      changedFundamentalInput(oldMetric, newMetric)
    );
  });
  if (hasUnclassifiedFundamentalChange) causes.add("restatement");

  return CAUSE_PRIORITY.filter((cause) => causes.has(cause));
}

function materialityFor({ materialityPolicy, previous, current, delta, primaryCause, allCauses, changedMetrics }) {
  if (!allCauses.every((cause) => ECONOMIC_CAUSES.has(cause))) return false;
  if (!materialityPolicy) return null;
  const result = materialityPolicy.evaluate({
    delta,
    primaryCause,
    allCauses: [...allCauses],
    changedMetrics: [...changedMetrics],
    previous,
    current,
    policyVersion: materialityPolicy.version,
  });
  if (typeof result !== "boolean") throw new TypeError("materialityPolicy.evaluate must return a boolean");
  return result;
}

function reasonCodes({ previous, current, allCauses, material, materialityPolicy, researchEligible, retry }) {
  const reasons = [];
  if (!previous) reasons.push("no_previous_observation");
  if (retry) reasons.push("identical_content_retry", "delta_zero");
  for (const cause of allCauses) reasons.push(`${cause}_change`);
  if (materialityPolicy && allCauses.every((cause) => ECONOMIC_CAUSES.has(cause))) {
    reasons.push(material === true ? "materiality_policy_accepted" : "materiality_policy_rejected");
  } else if (allCauses.some((cause) => ECONOMIC_CAUSES.has(cause)) && material === null) {
    reasons.push("materiality_policy_missing");
  }
  if (current && !current.actionable) reasons.push("current_observation_not_actionable");
  if (previous && previous.criticalMissingMetrics.length > 0) reasons.push("previous_thesis_critical_evidence_not_fresh");
  if (!researchEligible) reasons.push("research_ineligible");
  return [...new Set(reasons)];
}

/**
 * Compare two schema-valid observations without selecting, sizing, or creating
 * a proposal. Materiality is deliberately delegated to the caller's versioned
 * pure policy: absent policy means unknown (`material=null`) and ineligible.
 *
 * Accepts either `{ previous, current, materialityPolicy }` or the positional
 * `(previous, current, materialityPolicy)` form.
 */
export function classifyScoreDelta(input, maybeCurrent, maybePolicy) {
  const { previous: previousInput, current: currentInput, materialityPolicy: policyInput } = normalizeArguments(
    input,
    maybeCurrent,
    maybePolicy,
    arguments.length,
  );
  const current = MandateScoreObservationSchema.parse(currentInput);
  const previous = previousInput == null ? null : MandateScoreObservationSchema.parse(previousInput);
  const materialityPolicy = validatePolicy(policyInput);

  if (!previous) {
    const allCauses = ["initial"];
    return {
      delta: null,
      material: null,
      primaryCause: "initial",
      allCauses,
      researchEligible: false,
      reasonCodes: reasonCodes({ previous, current, allCauses, material: null, materialityPolicy, researchEligible: false, retry: false }),
      changedMetrics: [],
      coverageChanged: false,
      peerSetChanged: false,
      versionChanged: false,
    };
  }

  validateComparableSeries(previous, current);
  const delta = Number((current.score - previous.score).toFixed(10));
  const changedMetricRecords = buildMetricChanges(previous, current);
  const changedMetrics = changedMetricRecords.map(({ metricId }) => metricId);
  const coverageChanged = !sameContent(previous.coverageMask, current.coverageMask);
  const peerSetChanged = previous.peerSetId !== current.peerSetId ||
    previous.peerSetLevel !== current.peerSetLevel || previous.peerCount !== current.peerCount;
  const declaredVersionChanged = previous.mandateVersion !== current.mandateVersion ||
    previous.mandateUniverseVersion !== current.mandateUniverseVersion ||
    previous.productionUniversePolicyVersion !== current.productionUniversePolicyVersion ||
    previous.scoringConfigVersion !== current.scoringConfigVersion ||
    previous.codeRevision !== current.codeRevision;
  const retry = sameContent(observationContent(previous), observationContent(current));
  const { incomparableMetricIds, specialSectorChanged } = comparabilityChanges(previous, current, changedMetricRecords);
  const provenanceInconsistent = !retry && !declaredVersionChanged && !specialSectorChanged && incomparableMetricIds.size === 0 &&
    !coverageChanged && !peerSetChanged && changedMetricRecords.length === 0;
  const versionChanged = declaredVersionChanged || specialSectorChanged || incomparableMetricIds.size > 0 || provenanceInconsistent;
  const allCauses = retry ? ["retry"] : changedCauseSet({
    metricChanges: changedMetricRecords,
    incomparableMetricIds,
    coverageChanged,
    peerSetChanged,
    versionChanged,
  });
  const primaryCause = allCauses[0] ?? "restatement";
  if (allCauses.length === 0) allCauses.push("restatement");
  const material = materialityFor({ materialityPolicy, previous, current, delta, primaryCause, allCauses, changedMetrics });
  const bothCriticalEvidenceFresh = [previous, current].every((observation) =>
    observation.criticalMissingMetrics.length === 0 &&
    observation.metrics.filter((metric) => metric.thesisCritical).every((metric) => metric.freshnessState === "fresh"),
  );
  const researchEligible = material === true && allCauses.every((cause) => ECONOMIC_CAUSES.has(cause)) &&
    current.actionable && bothCriticalEvidenceFresh;

  return {
    delta: retry ? 0 : delta,
    material,
    primaryCause,
    allCauses,
    researchEligible,
    reasonCodes: [
      ...reasonCodes({ previous, current, allCauses, material, materialityPolicy, researchEligible, retry }),
      ...(specialSectorChanged || incomparableMetricIds.size > 0 ? ["incomparable_observation"] : []),
      ...(provenanceInconsistent ? ["unexplained_output_change"] : []),
    ].filter((reason, index, reasons) => reasons.indexOf(reason) === index),
    changedMetrics,
    coverageChanged,
    peerSetChanged,
    versionChanged,
  };
}

export default classifyScoreDelta;
