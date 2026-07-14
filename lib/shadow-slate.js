import { AgentIdSchema, TICKER_RE } from "../contracts/proposal.js";

function requireTicker(value, field) {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) throw new TypeError(`${field} must be a canonical ticker`);
  return ticker;
}

function requireAgentId(value, field) {
  if (value == null) return null;
  try {
    return AgentIdSchema.parse(value);
  } catch {
    throw new TypeError(`${field} must be a known agent ID`);
  }
}

function normalizeArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function normalizeSlate(value, field) {
  const seen = new Set();
  return normalizeArray(value, field).map((entry, index) => {
    const source = typeof entry === "string" ? { ticker: entry } : entry;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError(`${field}[${index}] must be an object or ticker`);
    const ticker = requireTicker(source.ticker, `${field}[${index}].ticker`);
    if (seen.has(ticker)) throw new TypeError(`${field} contains duplicate ticker: ${ticker}`);
    seen.add(ticker);
    return {
      ...source,
      ticker,
      agentId: requireAgentId(source.agentId, `${field}[${index}].agentId`),
      reasonCodes: [...new Set((Array.isArray(source.reasonCodes) ? source.reasonCodes : []).map(String))].sort(),
      triggeringObservationId: source.triggeringObservationId == null ? null : String(source.triggeringObservationId),
      triggeringEventId: source.triggeringEventId == null ? null : String(source.triggeringEventId),
    };
  }).sort((left, right) => {
    const leftRank = Number.isFinite(left.rank) ? left.rank : 0;
    const rightRank = Number.isFinite(right.rank) ? right.rank : 0;
    return leftRank - rightRank || left.ticker.localeCompare(right.ticker) || (left.agentId ?? "").localeCompare(right.agentId ?? "");
  });
}

function normalizeHoldings(value) {
  const seen = new Set();
  return normalizeArray(value, "holdings").map((entry, index) => {
    const ticker = requireTicker(typeof entry === "string" ? entry : entry?.ticker, `holdings[${index}]`);
    if (seen.has(ticker)) throw new TypeError(`holdings contains duplicate ticker: ${ticker}`);
    seen.add(ticker);
    return ticker;
  });
}

function withMetadata(item, metadata) {
  return { ...(metadata.get(item.ticker) ?? {}), ...item };
}

function summarizeItems(items) {
  const count = items.length;
  const bySector = new Map();
  let unknownSectorCount = 0;
  for (const item of items) {
    const sector = item.sector ?? item.subVertical ?? null;
    if (sector == null || String(sector).trim() === "") {
      unknownSectorCount++;
      continue;
    }
    const key = String(sector).trim();
    bySector.set(key, (bySector.get(key) ?? 0) + 1);
  }
  const sectors = [...bySector.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sector, sectorCount]) => ({ sector, count: sectorCount, share: count ? sectorCount / count : 0 }));
  const knownCaps = items
    .map((item) => ({ ticker: item.ticker, marketCap: Number(item.marketCap) }))
    .filter((item) => Number.isFinite(item.marketCap) && item.marketCap >= 0)
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
  const totalMarketCap = knownCaps.reduce((sum, item) => sum + item.marketCap, 0);
  const marketCaps = knownCaps.map((item) => ({
    ...item,
    share: totalMarketCap > 0 ? item.marketCap / totalMarketCap : null,
  }));
  const explicitBuckets = new Map();
  let unknownMarketCapCount = 0;
  for (const item of items) {
    const bucket = item.marketCapBucket ?? item.capBucket ?? item.marketCapCategory;
    if (bucket == null || String(bucket).trim() === "") {
      unknownMarketCapCount++;
      continue;
    }
    const key = String(bucket).trim();
    explicitBuckets.set(key, (explicitBuckets.get(key) ?? 0) + 1);
  }
  const marketCapBuckets = [...explicitBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketCount]) => ({ bucket, count: bucketCount, share: count ? bucketCount / count : 0 }));
  return {
    count,
    sectors,
    bySector: sectors,
    unknownSectorCount,
    maxSectorShare: sectors.reduce((max, item) => Math.max(max, item.share), 0),
    marketCapBuckets,
    byBucket: marketCapBuckets,
    unknownMarketCapCount,
    knownMarketCapCount: knownCaps.length,
    totalMarketCap,
    marketCaps,
  };
}

function ageSummary(items, now) {
  const ages = items.map((item) => {
    const timestamp = item.evidenceAt ?? item.observedAt ?? item.createdAt ?? item.lastResearchedAt ?? null;
    const timestampMs = Date.parse(timestamp ?? "");
    return Number.isFinite(timestampMs) ? now.getTime() - timestampMs : null;
  });
  const known = ages.filter((age) => age != null && age >= 0).sort((left, right) => left - right);
  const averageMs = known.length ? known.reduce((sum, age) => sum + age, 0) / known.length : null;
  const medianMs = known.length ? known[Math.floor((known.length - 1) / 2)] : null;
  return {
    count: items.length,
    knownCount: known.length,
    unknownCount: items.length - known.length,
    minMs: known[0] ?? null,
    maxMs: known.at(-1) ?? null,
    averageMs,
    medianMs,
    agesMs: ages,
  };
}

function uniqueTickers(items) {
  return [...new Set(items.map((item) => item.ticker))].sort();
}

/**
 * Compare two already-built research slates. Holdings are protected context,
 * not evidence of discovery-policy superiority: new/displaced/novelty and
 * turnover claims below are calculated on non-holdings only.
 */
export function compareShadowSlate(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("input must be an object");
  const currentRaw = input.currentSlate ?? input.currentRotationSlate ?? input.current?.slate ?? input.current ?? [];
  const proposedRaw = input.proposedSlate ?? input.proposedEvidenceSlate ?? input.proposed?.slate ?? input.proposed ?? [];
  const current = normalizeSlate(currentRaw, "currentSlate");
  const proposed = normalizeSlate(proposedRaw, "proposedSlate");
  const holdings = normalizeHoldings(input.holdings ?? []);
  const holdingSet = new Set(holdings);
  const metadata = new Map();
  for (const candidate of normalizeArray(input.candidatePool ?? input.currentCandidatePool ?? input.candidates, "candidatePool")) {
    if (!candidate || typeof candidate !== "object") throw new TypeError("candidatePool entries must be objects");
    const ticker = requireTicker(candidate.ticker, "candidatePool.ticker");
    if (metadata.has(ticker)) throw new TypeError(`candidatePool contains duplicate ticker: ${ticker}`);
    metadata.set(ticker, { ...candidate, ticker });
  }
  for (const event of normalizeArray(input.researchEvents ?? input.events, "researchEvents")) {
    if (!event || typeof event !== "object") throw new TypeError("researchEvents entries must be objects");
    const ticker = requireTicker(event.ticker, "researchEvents.ticker");
    if (metadata.has(ticker) && metadata.get(ticker)?.__researchEventEntry) {
      throw new TypeError(`researchEvents contains duplicate ticker: ${ticker}`);
    }
    const prior = metadata.get(ticker) ?? {};
    metadata.set(ticker, {
      ...prior,
      ...event,
      ticker,
      evidenceAt: prior.evidenceAt ?? event.createdAt ?? event.observedAt ?? null,
      __researchEventEntry: true,
    });
  }
  const currentEnriched = current.map((item) => withMetadata(item, metadata));
  const proposedEnriched = proposed.map((item) => withMetadata(item, metadata));
  const currentSet = new Set(current.map((item) => item.ticker));
  const proposedSet = new Set(proposed.map((item) => item.ticker));
  const overlapTickers = uniqueTickers(current.filter((item) => proposedSet.has(item.ticker)));
  const nonHoldingCurrent = current.filter((item) => !holdingSet.has(item.ticker));
  const nonHoldingProposed = proposed.filter((item) => !holdingSet.has(item.ticker));
  const nonHoldingCurrentSet = new Set(nonHoldingCurrent.map((item) => item.ticker));
  const nonHoldingProposedSet = new Set(nonHoldingProposed.map((item) => item.ticker));
  const overlapNonHoldingTickers = uniqueTickers(nonHoldingCurrent.filter((item) => nonHoldingProposedSet.has(item.ticker)));
  const selectedNonHoldings = nonHoldingProposed.filter((item) => !nonHoldingCurrentSet.has(item.ticker));
  const displacedNonHoldings = nonHoldingCurrent.filter((item) => !nonHoldingProposedSet.has(item.ticker));
  const now = input.now instanceof Date ? new Date(input.now) : new Date(input.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid Date or timestamp");
  const overlap = {
    tickers: overlapTickers,
    count: overlapTickers.length,
    currentCount: current.length,
    proposedCount: proposed.length,
    shareOfCurrent: current.length ? overlapTickers.length / current.length : 0,
    shareOfProposed: proposed.length ? overlapTickers.length / proposed.length : 0,
    nonHoldingTickers: overlapNonHoldingTickers,
    nonHoldingCount: overlapNonHoldingTickers.length,
    nonHoldingCurrentCount: nonHoldingCurrent.length,
    nonHoldingProposedCount: nonHoldingProposed.length,
    nonHoldingShareOfCurrent: nonHoldingCurrent.length ? overlapNonHoldingTickers.length / nonHoldingCurrent.length : 0,
    nonHoldingShareOfProposed: nonHoldingProposed.length ? overlapNonHoldingTickers.length / nonHoldingProposed.length : 0,
  };
  const selected = selectedNonHoldings.map((item) => ({ ...item, lineage: {
    ticker: item.ticker,
    agentId: item.agentId,
    reasonCodes: item.reasonCodes,
    triggeringObservationId: item.triggeringObservationId,
    triggeringEventId: item.triggeringEventId,
  }}));
  const displaced = displacedNonHoldings.map((item) => ({ ...item, lineage: {
    ticker: item.ticker,
    agentId: item.agentId,
    reasonCodes: item.reasonCodes,
    triggeringObservationId: item.triggeringObservationId,
    triggeringEventId: item.triggeringEventId,
  }}));
  const novelty = {
    tickers: selected.map((item) => item.ticker).sort(),
    count: selected.length,
    shareOfProposedNonHoldings: nonHoldingProposed.length ? selected.length / nonHoldingProposed.length : 0,
  };
  const turnover = {
    added: novelty.count,
    removed: displaced.length,
    count: Math.max(novelty.count, displaced.length),
    rateOfCurrentNonHoldings: nonHoldingCurrent.length ? displaced.length / nonHoldingCurrent.length : 0,
    rateOfProposedNonHoldings: nonHoldingProposed.length ? novelty.count / nonHoldingProposed.length : 0,
  };
  return {
    overlap,
    selected,
    selectedNonHoldings: selected,
    new: selected,
    newNonHoldings: selected,
    displaced,
    displacedNonHoldings: displaced,
    novelty,
    turnover,
    protectedHoldings: holdings,
    sectorConcentration: {
      current: summarizeItems(currentEnriched),
      proposed: summarizeItems(proposedEnriched),
    },
    marketCapConcentration: {
      current: summarizeItems(currentEnriched),
      proposed: summarizeItems(proposedEnriched),
    },
    evidenceAge: {
      current: ageSummary(currentEnriched, now),
      proposed: ageSummary(proposedEnriched, now),
    },
    evidenceAgeSummary: {
      current: ageSummary(currentEnriched, now),
      proposed: ageSummary(proposedEnriched, now),
    },
  };
}

export const compareShadowSlates = compareShadowSlate;
export default compareShadowSlate;
