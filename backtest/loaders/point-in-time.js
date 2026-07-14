/**
 * Pure point-in-time fixture loader for frozen-methodology backtests.
 *
 * This module deliberately has no adapters for production systems. Historical
 * acquisition, source reconciliation, and snapshot storage belong outside the
 * replay boundary; callers inject their already-versioned records here.
 */

function timestamp(value, path) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${path} requires an ISO timestamp`);
  return parsed;
}

function iso(value, path) {
  timestamp(value, path);
  return new Date(value).toISOString();
}

function securityId(record, path) {
  const id = String(record?.securityId ?? record?.ticker ?? "").trim();
  if (!id) throw new TypeError(`${path} requires securityId or ticker`);
  return id;
}

function clone(record) {
  return structuredClone(record);
}

function sortByTime(records, field) {
  return [...records].sort((left, right) =>
    timestamp(left[field], `${field}`) - timestamp(right[field], `${field}`) ||
    String(left.id ?? "").localeCompare(String(right.id ?? "")),
  );
}

function normalizeUniverseEvent(event, index) {
  const availableAt = event.availableAt ?? event.publishedAt ?? event.acceptedAt ?? event.effectiveAt;
  const effectiveAt = event.effectiveAt ?? availableAt;
  const action = event.action ?? "add";
  if (!['add', 'remove', 'update'].includes(action)) {
    throw new TypeError(`universeEvents[${index}].action must be add, remove, or update`);
  }
  return {
    ...clone(event),
    securityId: securityId(event, `universeEvents[${index}]`),
    action,
    availableAt: iso(availableAt, `universeEvents[${index}].availableAt`),
    effectiveAt: iso(effectiveAt, `universeEvents[${index}].effectiveAt`),
  };
}

function normalizeEvidenceEvent(event, index) {
  const availableAt = event.acceptedAt ?? event.publishedAt ?? event.availableAt;
  if (!availableAt) throw new TypeError(`evidenceEvents[${index}] requires acceptedAt, publishedAt, or availableAt`);
  return {
    ...clone(event),
    id: String(event.id ?? `evidence-${index}`),
    securityId: securityId(event, `evidenceEvents[${index}]`),
    availableAt: iso(availableAt, `evidenceEvents[${index}].availableAt`),
  };
}

function normalizeMarketRecord(record, index) {
  const completedAt = record.completedAt ?? record.timestamp;
  if (!completedAt) throw new TypeError(`marketData[${index}] requires completedAt or timestamp`);
  const price = Number(record.price ?? record.close ?? record.executablePrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new TypeError(`marketData[${index}] requires a positive price`);
  }
  const executableAt = record.executableAt == null ? null : iso(record.executableAt, `marketData[${index}].executableAt`);
  return {
    ...clone(record),
    id: String(record.id ?? `market-${index}`),
    securityId: securityId(record, `marketData[${index}]`),
    price,
    completedAt: iso(completedAt, `marketData[${index}].completedAt`),
    executableAt,
    regularSession: record.regularSession !== false,
  };
}

function normalizePolicy(policy, index) {
  const introducedAt = policy.introducedAt ?? policy.activeAt;
  const activeAt = policy.activeAt ?? introducedAt;
  const policyType = String(policy.policyType ?? policy.type ?? "").trim();
  const version = String(policy.version ?? "").trim();
  if (!policyType || !version) throw new TypeError(`policies[${index}] requires policyType/type and version`);
  return {
    ...clone(policy),
    policyType,
    version,
    introducedAt: iso(introducedAt, `policies[${index}].introducedAt`),
    activeAt: iso(activeAt, `policies[${index}].activeAt`),
  };
}

function activeUniverse(events, at) {
  const state = new Map();
  for (const event of events) {
    if (timestamp(event.availableAt, "availableAt") > at || timestamp(event.effectiveAt, "effectiveAt") > at) continue;
    if (event.action === "remove") {
      const prior = state.get(event.securityId) ?? { securityId: event.securityId };
      state.set(event.securityId, { ...prior, ...event, eligible: false, exclusionReason: event.reason ?? "removed_from_universe" });
      continue;
    }
    const prior = state.get(event.securityId) ?? {};
    state.set(event.securityId, { ...prior, ...event, eligible: event.eligible !== false, exclusionReason: event.reason ?? null });
  }
  return [...state.values()].sort((left, right) => left.securityId.localeCompare(right.securityId));
}

/**
 * Rejects a walk-forward selection that references a version not yet
 * introduced at its evaluation timestamp. Pass only the versions selected for
 * that window; the loader may contain later versions without exposing them.
 */
export function assertWalkForwardInputs({ evaluationAt, policies = [], calibrations = [] } = {}) {
  const cutoff = timestamp(evaluationAt, "evaluationAt");
  for (const [label, records] of [["policies", policies], ["calibrations", calibrations]]) {
    if (!Array.isArray(records)) throw new TypeError(`${label} must be an array`);
    for (const [index, record] of records.entries()) {
      const introducedAt = record?.introducedAt ?? record?.activeAt;
      if (!introducedAt) throw new TypeError(`${label}[${index}] requires introducedAt`);
      if (timestamp(introducedAt, `${label}[${index}].introducedAt`) > cutoff) {
        throw new RangeError(`${label}[${index}] version ${record.version ?? "unknown"} was first introduced after evaluationAt`);
      }
    }
  }
  return true;
}

/** Creates a deterministic, read-only view over injected historical records. */
export function createPointInTimeLoader({ universeEvents = [], evidenceEvents = [], marketData = [], policies = [] } = {}) {
  const universe = sortByTime(universeEvents.map(normalizeUniverseEvent), "availableAt");
  const evidence = sortByTime(evidenceEvents.map(normalizeEvidenceEvent), "availableAt");
  const market = sortByTime(marketData.map(normalizeMarketRecord), "completedAt");
  const policyRecords = sortByTime(policies.map(normalizePolicy), "activeAt");

  function snapshotAt(atValue) {
    const at = timestamp(atValue, "snapshotAt.at");
    const visiblePolicies = policyRecords.filter((policy) =>
      timestamp(policy.introducedAt, "introducedAt") <= at && timestamp(policy.activeAt, "activeAt") <= at,
    );
    const activePolicies = new Map();
    for (const policy of visiblePolicies) activePolicies.set(policy.policyType, policy);
    return {
      asOf: new Date(at).toISOString(),
      universe: activeUniverse(universe, at).map(clone),
      evidence: evidence.filter((event) => timestamp(event.availableAt, "availableAt") <= at).map(clone),
      marketData: market.filter((record) => timestamp(record.completedAt, "completedAt") <= at).map(clone),
      policies: [...activePolicies.values()].sort((left, right) => left.policyType.localeCompare(right.policyType)).map(clone),
    };
  }

  function nextRegularSessionPrice(id, after) {
    const afterMs = timestamp(after, "nextRegularSessionPrice.after");
    const match = market
      .filter((record) => record.securityId === id && record.regularSession && record.executableAt &&
        timestamp(record.executableAt, "executableAt") > afterMs)
      .sort((left, right) => timestamp(left.executableAt, "executableAt") - timestamp(right.executableAt, "executableAt") ||
        left.id.localeCompare(right.id))[0];
    return match ? clone(match) : null;
  }

  function firstCompletedPriceAtOrAfter(id, atValue, notAfter = null) {
    const lower = timestamp(atValue, "firstCompletedPriceAtOrAfter.at");
    const upper = notAfter == null ? Infinity : timestamp(notAfter, "firstCompletedPriceAtOrAfter.notAfter");
    const match = market.find((record) => record.securityId === id &&
      timestamp(record.completedAt, "completedAt") >= lower && timestamp(record.completedAt, "completedAt") <= upper);
    return match ? clone(match) : null;
  }

  function completedPricePath(id, from, through) {
    const lower = timestamp(from, "completedPricePath.from");
    const upper = timestamp(through, "completedPricePath.through");
    return market.filter((record) => record.securityId === id &&
      timestamp(record.completedAt, "completedAt") >= lower && timestamp(record.completedAt, "completedAt") <= upper).map(clone);
  }

  return Object.freeze({
    snapshotAt,
    nextRegularSessionPrice,
    firstCompletedPriceAtOrAfter,
    completedPricePath,
  });
}

export default createPointInTimeLoader;
