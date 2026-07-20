export const CATALOG_SCREEN_POLICY_VERSIONS = Object.freeze({
  "agent-1": "agent-1-sector-agnostic-velocity-catalog-v1",
  "agent-2": "agent-2-medium-momentum-catalog-v1",
  "agent-3": "agent-3-compounder-catalog-v1",
});

function reject(rejected, candidate, reasonCode, reason) {
  rejected.push({
    ticker: candidate?.ticker ?? "UNKNOWN",
    reasonCode,
    reason,
  });
}

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function screenAgentOne(candidates, limits) {
  const passed = [];
  const rejected = [];
  const microCapCeiling = 300_000_000;
  const microCapFloor = finiteNonnegative(limits.microCapMinAvgDollarVolume)
    ? limits.microCapMinAvgDollarVolume
    : 3_000_000;
  const ordinaryFloor = finiteNonnegative(limits.minAvgDollarVolume)
    ? limits.minAvgDollarVolume
    : 10_000_000;

  for (const candidate of candidates) {
    if (!finiteNonnegative(candidate.marketCap)) {
      reject(rejected, candidate, "market_cap_unavailable", "market capitalization unavailable — Agent One cannot select the applicable liquidity floor");
      continue;
    }
    if (!finiteNonnegative(candidate.avgDollarVolume)) {
      reject(rejected, candidate, "avg_dollar_volume_unavailable", "average daily dollar volume unavailable — Agent One liquidity is unverifiable");
      continue;
    }
    const floor = candidate.marketCap < microCapCeiling ? microCapFloor : ordinaryFloor;
    if (candidate.avgDollarVolume < floor) {
      reject(rejected, candidate, "avg_dollar_volume_below_floor", `average daily dollar volume below Agent One's applicable $${floor.toLocaleString()} floor`);
      continue;
    }
    passed.push(candidate);
  }
  return { passed, rejected };
}

function screenAgentTwo(candidates, limits) {
  const passed = [];
  const rejected = [];
  const minMarketCap = finiteNonnegative(limits.minMarketCap) ? limits.minMarketCap : 300_000_000;
  const minAvgDollarVolume = finiteNonnegative(limits.minAvgDollarVolume) ? limits.minAvgDollarVolume : 10_000_000;

  for (const candidate of candidates) {
    if (!finiteNonnegative(candidate.marketCap)) {
      reject(rejected, candidate, "market_cap_unavailable", "market capitalization unavailable — Agent Two cannot verify its no-microcap universe");
      continue;
    }
    if (candidate.marketCap < minMarketCap) {
      reject(rejected, candidate, "market_cap_below_floor", `market capitalization below Agent Two's $${minMarketCap.toLocaleString()} floor`);
      continue;
    }
    if (!finiteNonnegative(candidate.avgDollarVolume)) {
      reject(rejected, candidate, "avg_dollar_volume_unavailable", "average daily dollar volume unavailable — Agent Two liquidity is unverifiable");
      continue;
    }
    if (candidate.avgDollarVolume < minAvgDollarVolume) {
      reject(rejected, candidate, "avg_dollar_volume_below_floor", `average daily dollar volume below Agent Two's $${minAvgDollarVolume.toLocaleString()} floor`);
      continue;
    }
    passed.push(candidate);
  }
  return { passed, rejected };
}

function screenAgentThree(candidates, limits) {
  const passed = [];
  const rejected = [];
  const minAvgDollarVolume = finiteNonnegative(limits.minAvgDollarVolume) ? limits.minAvgDollarVolume : 10_000_000;

  for (const candidate of candidates) {
    if (!finiteNonnegative(candidate.avgDollarVolume)) {
      reject(rejected, candidate, "avg_dollar_volume_unavailable", "average daily dollar volume unavailable — Agent Three liquidity is unverifiable");
      continue;
    }
    if (candidate.avgDollarVolume < minAvgDollarVolume) {
      reject(rejected, candidate, "avg_dollar_volume_below_floor", `average daily dollar volume below Agent Three's $${minAvgDollarVolume.toLocaleString()} floor`);
      continue;
    }
    // Agent Three prefers mid/large companies but does not define a hard
    // capitalization floor. Balance-sheet durability and valuation are later
    // evidence/entry gates, not facts this quote catalog can honestly infer.
    passed.push(candidate);
  }
  return { passed, rejected };
}

/**
 * Pure mandate-specific catalog screen. The shared catalog is only an attention
 * source; passing this screen is never a recommendation or an entry-gate pass.
 */
export function screenCatalogForAgent(agentId, candidates = [], limits = {}) {
  if (agentId === "agent-1") return screenAgentOne(candidates, limits);
  if (agentId === "agent-2") return screenAgentTwo(candidates, limits);
  if (agentId === "agent-3") return screenAgentThree(candidates, limits);
  throw new TypeError(`Unsupported research agent for catalog screen: ${String(agentId)}`);
}
