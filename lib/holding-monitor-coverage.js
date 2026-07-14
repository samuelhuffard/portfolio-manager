export const HOLDING_MONITOR_SCHEMA_VERSION = "holding-monitor-coverage-v1";

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Privacy-safe coverage proof for a job that examines every held security.
 * `degraded` means the ticker was explicitly handled with unavailable/partial
 * evidence and action was conservatively blocked or downgraded. It is not a
 * silent skip. No tickers, prices, or rationales belong in this record.
 */
export function buildHoldingMonitorCoverage({ expected, monitored, degraded, failed = 0, reasons = {} }) {
  const normalized = {
    expected: count(expected),
    monitored: count(monitored),
    degraded: count(degraded),
    failed: count(failed),
  };
  const validCounts = Object.values(normalized).every((value) => value != null);
  const accounted = validCounts ? normalized.monitored + normalized.degraded + normalized.failed : null;
  const silentSkipped = validCounts ? Math.max(0, normalized.expected - accounted) : null;
  const overflow = validCounts ? Math.max(0, accounted - normalized.expected) : null;
  const normalizedReasons = Object.fromEntries(Object.entries(reasons)
    .filter(([, value]) => Number.isInteger(value) && value > 0)
    .sort(([left], [right]) => left.localeCompare(right)));
  const reasonTotal = Object.values(normalizedReasons).reduce((sum, value) => sum + value, 0);
  const reasonAccountingComplete = validCounts && reasonTotal === normalized.degraded + normalized.failed;
  return {
    schemaVersion: HOLDING_MONITOR_SCHEMA_VERSION,
    ...normalized,
    accounted,
    silentSkipped,
    overflow,
    reasonTotal,
    reasonAccountingComplete,
    complete: validCounts && normalized.failed === 0 && silentSkipped === 0 && overflow === 0 && reasonAccountingComplete,
    reasons: normalizedReasons,
  };
}

export function holdingMonitorCoveragePasses(value) {
  if (value?.schemaVersion !== HOLDING_MONITOR_SCHEMA_VERSION) return false;
  const rebuilt = buildHoldingMonitorCoverage(value);
  return rebuilt.complete === true
    && value.complete === true
    && value.accounted === rebuilt.accounted
    && value.silentSkipped === 0
    && value.overflow === 0
    && value.reasonAccountingComplete === true
    && value.reasonTotal === rebuilt.reasonTotal;
}
