export const CATALOG_SCREEN_POLICY_VERSIONS = Object.freeze({
  "agent-1": "agent-1-sector-agnostic-velocity-catalog-v1",
  "agent-2": "agent-2-medium-momentum-catalog-v1",
  "agent-3": "agent-3-compounder-catalog-v1",
});

// This is deliberately separate from the liquidity catalog screen.  All three
// v3 mandates are sector-agnostic, so a company being a bank, retailer, or
// manufacturer is never by itself a reason to remove it from discovery.  The
// classification exists to stop a later thesis from describing a company as a
// different kind of business than the catalog evidence supports.
export const BUSINESS_CLASSIFICATION_POLICY_VERSION = "observed-business-family-v1";

const BUSINESS_FAMILIES = new Set([
  "technology",
  "financial_services",
  "healthcare",
  "consumer",
  "industrials",
  "energy",
  "materials",
  "real_estate",
  "utilities",
  "communications",
  "other",
]);

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

/**
 * Classify from the observed broad sector and industry only.  `subVertical` is
 * intentionally excluded: it is a convenience label from an older Agent One
 * screen and must never turn a regional bank or fintech into "technology".
 */
export function observedBusinessFamily(candidate = {}) {
  const sector = normalizedText(candidate.sector);
  const industry = normalizedText(candidate.industry);
  const combined = `${sector} ${industry}`.trim();
  const sourceFields = [
    ...(sector ? ["sector"] : []),
    ...(industry ? ["industry"] : []),
  ];

  if (!combined) return { family: null, sourceFields };

  // Broad-sector evidence wins over ambiguous industry wording such as
  // "fintech".  A Financial Services company may use technology, but that is
  // not evidence that its operating business is a technology company.
  if (sector.includes("financial") || includesAny(industry, ["bank", "insurance", "credit services", "capital markets", "asset management", "mortgage"])) {
    return { family: "financial_services", sourceFields };
  }
  if (sector.includes("technology") || includesAny(industry, ["software", "semiconductor", "information technology", "computer hardware", "communication equipment", "electronic components"])) {
    return { family: "technology", sourceFields };
  }
  if (sector.includes("health") || includesAny(industry, ["biotech", "medical", "drug", "pharmaceutical", "health information"])) {
    return { family: "healthcare", sourceFields };
  }
  if (sector.includes("consumer") || includesAny(industry, ["retail", "restaurant", "beverage", "apparel", "leisure", "gambling", "auto"])) {
    return { family: "consumer", sourceFields };
  }
  if (sector.includes("industrial") || includesAny(industry, ["aerospace", "defense", "engineering", "machinery", "transportation", "construction"])) {
    return { family: "industrials", sourceFields };
  }
  if (sector.includes("energy") || includesAny(industry, ["oil", "gas", "uranium", "coal"])) {
    return { family: "energy", sourceFields };
  }
  if (sector.includes("basic materials") || sector.includes("materials") || includesAny(industry, ["chemical", "steel", "metal", "mining", "lumber"])) {
    return { family: "materials", sourceFields };
  }
  if (sector.includes("real estate") || includesAny(industry, ["reit", "real estate"])) {
    return { family: "real_estate", sourceFields };
  }
  if (sector.includes("utilities") || includesAny(industry, ["utility", "regulated electric", "regulated gas"])) {
    return { family: "utilities", sourceFields };
  }
  if (sector.includes("communication") || includesAny(industry, ["telecom", "entertainment", "broadcast", "advertising", "publishing"])) {
    return { family: "communications", sourceFields };
  }
  return { family: "other", sourceFields };
}

/**
 * Deterministically validate a proposed business-family description against
 * catalog evidence.  It does not impose a sector restriction on any v3 agent:
 * with no claim, every observed business family remains research-eligible.
 *
 * `claimedBusinessFamily` is intended for the proposal/thesis boundary.  A
 * caller must pass the normalized category the draft calls the business (for
 * example, "technology").  A mismatch fails closed so that an old
 * sub-vertical label cannot justify a false mandate or business description.
 */
export function evaluateMandateBusinessEligibility({
  agentId,
  candidate = {},
  claimedBusinessFamily = null,
} = {}) {
  if (!Object.hasOwn(CATALOG_SCREEN_POLICY_VERSIONS, agentId)) {
    throw new TypeError(`Unsupported research agent for business eligibility: ${String(agentId)}`);
  }
  const classification = observedBusinessFamily(candidate);
  const claimed = normalizedText(claimedBusinessFamily).replace(/[ -]+/g, "_");

  if (claimed && !BUSINESS_FAMILIES.has(claimed)) {
    return {
      policyVersion: BUSINESS_CLASSIFICATION_POLICY_VERSION,
      agentId,
      eligible: false,
      reasonCode: "business_family_claim_invalid",
      reason: "claimed business family is not a supported deterministic category",
      classification,
      claimedBusinessFamily: claimed,
    };
  }
  if (claimed && !classification.family) {
    return {
      policyVersion: BUSINESS_CLASSIFICATION_POLICY_VERSION,
      agentId,
      eligible: false,
      reasonCode: "business_family_unverifiable",
      reason: "a business-family claim requires observed sector or industry evidence",
      classification,
      claimedBusinessFamily: claimed,
    };
  }
  if (claimed && claimed !== classification.family) {
    return {
      policyVersion: BUSINESS_CLASSIFICATION_POLICY_VERSION,
      agentId,
      eligible: false,
      reasonCode: "business_family_claim_mismatch",
      reason: `claimed ${claimed} business family conflicts with observed ${classification.family} classification`,
      classification,
      claimedBusinessFamily: claimed,
    };
  }
  return {
    policyVersion: BUSINESS_CLASSIFICATION_POLICY_VERSION,
    agentId,
    eligible: true,
    reasonCode: classification.family ? "business_family_observed" : "business_family_not_required_for_sector_agnostic_discovery",
    reason: classification.family
      ? "observed business family is compatible with the sector-agnostic v3 discovery mandate"
      : "sector-agnostic v3 discovery does not require a business-family classification",
    classification,
    claimedBusinessFamily: claimed || null,
  };
}

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
