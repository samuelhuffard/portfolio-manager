/**
 * Pure accounting for deterministic mandate-score coverage.
 *
 * Completeness, freshness, and an explicit stable unsupported reason are
 * intentionally separate dimensions. A row with a fresh partial score is not
 * a complete score, and an unsupported sector is not silently counted as a
 * successful score.
 */

const DEFAULT_STATES = Object.freeze(["fresh", "stale", "unavailable", "unsupported", "unknown"]);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const asArray = (value) => Array.isArray(value) ? value : [];

function metricRecord(row, metricId) {
  const nested = row?.perMetric?.[metricId] ?? row?.metrics?.[metricId] ?? null;
  if (nested && typeof nested === "object") return nested;
  return { value: nested };
}

function hasNestedMetricEvidence(row) {
  return Boolean(row?.perMetric && typeof row.perMetric === "object") || Boolean(row?.metrics && typeof row.metrics === "object");
}

function missingSet(row) {
  return new Set(asArray(row?.missingMetrics).map(String));
}

function reasonFor(row, metricId, record) {
  const byMetric = row?.unsupportedReasonByMetric ?? row?.unsupportedReasonsByMetric ?? {};
  const value = byMetric?.[metricId] ?? record?.unsupportedReason ?? null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (row?.unsupportedReason && typeof row.unsupportedReason === "string" && (row?.supported === false || row?.unsupported === true)) return row.unsupportedReason.trim();
  return null;
}

function freshnessState(row, record) {
  const explicit = record?.freshnessState ?? record?.freshness ?? row?.freshnessState ?? row?.freshness;
  if (typeof explicit === "string" && DEFAULT_STATES.includes(explicit)) return explicit;
  if (record?.fresh === true || row?.fresh === true) return "fresh";
  if (record?.stale === true || row?.stale === true) return "stale";
  if (record?.unsupported === true || row?.unsupported === true || (row?.supported === false && row?.unsupportedReason)) return "unsupported";
  return "unknown";
}

function metricStatus(row, metricId) {
  const record = metricRecord(row, metricId);
  const missing = missingSet(row).has(metricId) || record?.missing === true;
  const points = record?.points ?? record?.score ?? record?.value;
  const complete = !missing && (finite(points) || record?.complete === true || (!hasNestedMetricEvidence(row) && row?.complete === true && asArray(row?.missingMetrics).length === 0));
  const state = freshnessState(row, record);
  const unsupportedReason = reasonFor(row, metricId, record);
  const explicitUnsupported = state === "unsupported" || Boolean(unsupportedReason);
  return {
    complete,
    state,
    fresh: state === "fresh",
    stale: state === "stale",
    unsupported: state === "unsupported",
    unavailable: state === "unavailable" || (!complete && !explicitUnsupported && state === "unknown"),
    explicitUnsupported,
    unsupportedReason,
  };
}

/** Summarize metric-level and row-level score coverage without making policy decisions. */
export function summarizeMetricCoverage(rows = [], metricIds = []) {
  const safeRows = asArray(rows);
  const ids = [...new Set(asArray(metricIds).map(String))].sort();
  const metrics = Object.fromEntries(ids.map((metricId) => [metricId, {
    total: safeRows.length,
    complete: 0,
    fresh: 0,
    stale: 0,
    unavailable: 0,
    unsupported: 0,
    explicitUnsupported: 0,
    missing: 0,
    unsupportedReasons: {},
  }]));

  let completeRows = 0;
  let freshRows = 0;
  let freshOrExplicitUnsupportedRows = 0;
  let explicitUnsupportedRows = 0;
  for (const row of safeRows) {
    const statuses = ids.map((id) => metricStatus(row, id));
    if ((ids.length > 0 && statuses.every((status) => status.complete)) || (ids.length === 0 && row?.complete === true)) completeRows++;
    if (statuses.length > 0 && statuses.every((status) => status.fresh)) freshRows++;
    if (statuses.length > 0 && statuses.every((status) => status.fresh || status.explicitUnsupported)) freshOrExplicitUnsupportedRows++;
    if (statuses.length > 0 && statuses.every((status) => status.explicitUnsupported)) explicitUnsupportedRows++;
    for (const [metricId, status] of ids.map((id, index) => [id, statuses[index]])) {
      const bucket = metrics[metricId];
      if (status.complete) bucket.complete++;
      if (status.fresh) bucket.fresh++;
      if (status.stale) bucket.stale++;
      if (status.unavailable) bucket.unavailable++;
      if (status.unsupported) bucket.unsupported++;
      if (status.explicitUnsupported) {
        bucket.explicitUnsupported++;
        if (status.unsupportedReason) bucket.unsupportedReasons[status.unsupportedReason] = (bucket.unsupportedReasons[status.unsupportedReason] ?? 0) + 1;
      }
      if (!status.complete) bucket.missing++;
    }
  }

  const total = safeRows.length;
  const ratio = (value) => total ? value / total : 0;
  const completeRate = ratio(completeRows);
  const freshRate = ratio(freshRows);
  const freshOrExplicitUnsupportedRate = ratio(freshOrExplicitUnsupportedRows);
  return {
    total,
    rowCount: total,
    metricIds: ids,
    metrics,
    complete: completeRows,
    completeCount: completeRows,
    completeRate,
    fresh: freshRows,
    freshCount: freshRows,
    freshRate,
    explicitUnsupported: explicitUnsupportedRows,
    explicitUnsupportedCount: explicitUnsupportedRows,
    explicitUnsupportedRate: ratio(explicitUnsupportedRows),
    freshOrExplicitUnsupported: freshOrExplicitUnsupportedRows,
    freshOrExplicitUnsupportedCount: freshOrExplicitUnsupportedRows,
    freshOrExplicitUnsupportedRate,
  };
}

/** Count explicit freshness states; unknown is retained instead of being called fresh. */
export function freshnessHistogram(rows = [], _now = new Date()) {
  const histogram = Object.fromEntries(DEFAULT_STATES.map((state) => [state, 0]));
  for (const row of asArray(rows)) {
    const ids = asArray(row?.metricIds).length
      ? asArray(row.metricIds)
      : (row?.perMetric && typeof row.perMetric === "object" ? Object.keys(row.perMetric) : []);
    const states = ids.length ? ids.map((id) => freshnessState(row, metricRecord(row, id))) : [freshnessState(row, {})];
    for (const state of states) histogram[state] = (histogram[state] ?? 0) + 1;
  }
  return histogram;
}

/** Count stable unsupported reasons without conflating missing or stale data. */
export function unsupportedReasonCounts(rows = []) {
  const counts = {};
  const add = (reason) => {
    if (typeof reason === "string" && reason.trim()) counts[reason.trim()] = (counts[reason.trim()] ?? 0) + 1;
  };
  for (const row of asArray(rows)) {
    const rowReasons = new Set();
    const collect = (reason) => {
      if (typeof reason === "string" && reason.trim()) rowReasons.add(reason.trim());
    };
    collect(row?.unsupportedReason);
    for (const reason of asArray(row?.unsupportedReasons)) collect(reason);
    for (const reason of Object.values(row?.unsupportedReasonByMetric ?? {})) collect(reason);
    for (const record of Object.values(row?.perMetric ?? {})) {
      if (record?.unsupported === true || record?.freshnessState === "unsupported") collect(record.unsupportedReason ?? "unsupported");
      else collect(record?.unsupportedReason);
    }
    for (const reason of rowReasons) add(reason);
  }
  return counts;
}

/**
 * Apply an explicit policy to a summary. Defaults are advisory and conservative:
 * an empty cohort never passes, and complete coverage is distinct from fresh or
 * explicitly unsupported coverage.
 */
export function coverageGate(summary = {}, policy = {}) {
  const total = Number.isFinite(summary.total) ? summary.total : Number(summary.rowCount ?? 0);
  const minCompleteRate = Number.isFinite(policy.minCompleteRate) ? policy.minCompleteRate : 1;
  const minFreshOrExplicitUnsupportedRate = Number.isFinite(policy.minFreshOrExplicitUnsupportedRate)
    ? policy.minFreshOrExplicitUnsupportedRate
    : (Number.isFinite(policy.minFreshRate) ? policy.minFreshRate : 0.9);
  const checks = {
    nonEmpty: total > 0,
    complete: (summary.completeRate ?? 0) >= minCompleteRate,
    freshOrExplicitUnsupported: (summary.freshOrExplicitUnsupportedRate ?? 0) >= minFreshOrExplicitUnsupportedRate,
  };
  const reasons = [];
  if (!checks.nonEmpty) reasons.push("zero_cohort");
  if (!checks.complete) reasons.push("incomplete_scores");
  if (!checks.freshOrExplicitUnsupported) reasons.push("insufficient_fresh_or_explicit_unsupported");
  return {
    pass: Object.values(checks).every(Boolean),
    eligible: Object.values(checks).every(Boolean),
    checks,
    reasons,
    policy: { minCompleteRate, minFreshOrExplicitUnsupportedRate },
  };
}
