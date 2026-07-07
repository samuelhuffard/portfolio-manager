import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";

let _redis = null;

export function getRedis() {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) return null; // gracefully skip if not configured
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Single shared spreadsheet for the whole portfolio (one Robinhood account, one
// investor pool, one set of Holdings/Performance/Trade Ledger/Lots/Investors tabs).
// Agents still each get their own internal tab (see lib/sheets.js agentTabName),
// but that's a tab within this same spreadsheet, not a separate spreadsheet ID.
export async function getCachedSharedSpreadsheetId() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get("pm:shared:spreadsheet-id");
  } catch (e) {
    console.warn("[Redis] Failed to get shared spreadsheet id:", e.message);
    return null;
  }
}

export async function setCachedSharedSpreadsheetId(id) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:shared:spreadsheet-id", id);
  } catch (e) {
    console.warn("[Redis] Failed to set shared spreadsheet id:", e.message);
  }
}

// Tracks the last successfully-processed Robinhood order timestamp, so each
// holdings-sync run only asks robinhood-sync.py for fills since then.
export async function getLastFillSyncAt() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get("pm:last-fill-sync-at");
  } catch (e) {
    console.warn("[Redis] Failed to get last fill sync timestamp:", e.message);
    return null;
  }
}

export async function setLastFillSyncAt(iso) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:last-fill-sync-at", iso);
  } catch (e) {
    console.warn("[Redis] Failed to set last fill sync timestamp:", e.message);
  }
}

// Mirrors config/tax.json's reserveRatePct into Redis so the dashboard (a
// separate Vercel deployment with no filesystem access to this repo's config)
// can show the same withdrawal tax-reserve estimate without duplicating config.
export async function setCachedTaxReserveRatePct(rate) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:tax:reserve-rate-pct", rate);
  } catch (e) {
    console.warn("[Redis] Failed to set tax reserve rate:", e.message);
  }
}

// Approval queue — same Redis keys the dashboard's lib/proposals.ts writes/reads,
// so a fill can be matched back to the specific agent proposal Sam approved for it.
const PROPOSALS_LIST_KEY = "pm:approval_proposals";
const PROPOSAL_EXPIRY_MS = 48 * 60 * 60 * 1000; // undecided proposals disappear 48h after creation

function proposalKeyFor(id) {
  return `pm:approval_proposal:${id}`;
}

// A Pending proposal that's sat undecided for 48h is stale — flips it to Expired
// (persisted, mirrors portfolio-dashboard's lib/proposals.ts expiry) so it stops
// blocking hasOpenProposal() and stops showing as actionable in the approval queue.
// Decided/fulfilled proposals never expire.
async function expireProposalIfNeeded(proposal, redis) {
  if (!proposal || proposal.status !== "Pending") return proposal;
  const expiresAt = proposal.expiresAt ?? new Date(Date.parse(proposal.createdAt) + PROPOSAL_EXPIRY_MS).toISOString();
  if (Date.now() < Date.parse(expiresAt)) return proposal;
  const expired = { ...proposal, status: "Expired", expiresAt, updatedAt: new Date().toISOString() };
  try {
    await redis.set(proposalKeyFor(expired.id), JSON.stringify(expired));
  } catch (e) {
    console.warn(`[Redis] Failed to persist expiry for proposal ${expired.id}:`, e.message);
  }
  return expired;
}

export async function getProposalById(proposalId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(proposalKeyFor(proposalId));
    const proposal = typeof raw === "string" ? JSON.parse(raw) : raw;
    return proposal ? await expireProposalIfNeeded(proposal, redis) : proposal;
  } catch (e) {
    console.warn(`[Redis] Failed to get proposal ${proposalId}:`, e.message);
    return null;
  }
}

export async function listOpenApprovedProposals(limit = 250) {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const ids = await redis.lrange(PROPOSALS_LIST_KEY, 0, limit - 1);
    const proposals = await Promise.all(
      ids.map((id) =>
        redis
          .get(proposalKeyFor(id))
          .then((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
          .catch(() => null)
      )
    );
    return proposals.filter((p) => p && p.status === "ApprovedForBrokerReview" && !p.fulfilledAt);
  } catch (e) {
    console.warn("[Redis] Failed to list approved proposals:", e.message);
    return [];
  }
}

export async function markProposalFulfilled(proposalId, tradeId, now = new Date().toISOString()) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured.");
  try {
    const raw = await redis.get(proposalKeyFor(proposalId));
    const proposal = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!proposal) throw new Error("Proposal not found.");
    if (proposal.status !== "ApprovedForBrokerReview") throw new Error("Proposal is not approved.");
    if (proposal.fulfilledAt && proposal.fulfilledTradeId !== tradeId && proposal.fulfilledOrderId !== tradeId) {
      throw new Error("Proposal is already fulfilled.");
    }
    proposal.fulfilledAt = now;
    proposal.fulfilledTradeId = tradeId;
    // The dashboard's AllocationProposal type reads fulfilledOrderId — write both
    // names so a backend-fulfilled proposal doesn't render as "fulfilled, no order"
    // in the UI (known cross-repo schema drift).
    proposal.fulfilledOrderId = tradeId;
    proposal.updatedAt = now;
    await redis.set(proposalKeyFor(proposalId), JSON.stringify(proposal));
    return proposal;
  } catch (e) {
    throw new Error(`Failed to mark proposal ${proposalId} fulfilled: ${e.message}`);
  }
}

const PROPOSALS_MAX = 250; // mirrors portfolio-dashboard's lib/proposals.ts MAX_PROPOSALS

export async function listAllProposals(limit = PROPOSALS_MAX) {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const ids = await redis.lrange(PROPOSALS_LIST_KEY, 0, limit - 1);
    const proposals = await Promise.all(
      ids.map((id) =>
        redis
          .get(proposalKeyFor(id))
          .then((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
          .then((proposal) => (proposal ? expireProposalIfNeeded(proposal, redis) : proposal))
          .catch(() => null)
      )
    );
    return proposals.filter(Boolean);
  } catch (e) {
    console.warn("[Redis] Failed to list proposals:", e.message);
    return [];
  }
}

/**
 * Queues a research agent's risk-gated BUY/SELL straight into the same approval
 * queue the dashboard's /approvals page reads — Sam still approves or rejects
 * each one there before anything is placed on Robinhood. Mirrors the validation
 * portfolio-dashboard's lib/proposals.ts applies on its POST /api/proposals route,
 * since this writes to the identical Redis schema from a different repo.
 */
export async function createProposal({ agentId, ticker, side, amountDollars, maxPrice, rationale, riskSummary }) {
  const redis = getRedis();
  if (!redis) {
    // This is the research pipeline's OUTPUT — losing it silently is the
    // historic "scan ran, zero proposals, nobody noticed" failure mode.
    console.error(
      `[Redis] NOT CONFIGURED (UPSTASH_REDIS_REST_URL/TOKEN missing) — proposal DROPPED: ${agentId} ${side} $${amountDollars} ${ticker}`
    );
    return null;
  }

  if (!ticker || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new Error(`Invalid ticker for proposal: ${ticker}`);
  if (side !== "BUY" && side !== "SELL") throw new Error(`Invalid side for proposal: ${side}`);
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) throw new Error(`Invalid amountDollars for proposal: ${amountDollars}`);
  if (!rationale || !rationale.trim()) throw new Error("Proposal rationale is required.");

  const now = new Date().toISOString();
  const proposal = {
    id: randomUUID(),
    agentId,
    ticker,
    side,
    amountDollars: Math.round(amountDollars * 100) / 100,
    maxPrice: maxPrice != null ? Math.round(maxPrice * 100) / 100 : null,
    rationale: rationale.trim(),
    riskSummary: (riskSummary ?? "").trim() || "Generated by automated research scan; no manager risk note added.",
    status: "Pending",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.parse(now) + PROPOSAL_EXPIRY_MS).toISOString(),
    createdByUserId: "system:research-scan",
    createdByEmail: null,
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    fulfilledAt: null,
    fulfilledTradeId: null,
    fulfilledOrderId: null,
    fulfilledShares: null,
    decisionHmac: null,
  };

  try {
    await redis.set(proposalKeyFor(proposal.id), JSON.stringify(proposal));
    await redis.lpush(PROPOSALS_LIST_KEY, proposal.id);
    await redis.ltrim(PROPOSALS_LIST_KEY, 0, PROPOSALS_MAX - 1);
    return proposal;
  } catch (e) {
    console.warn(`[Redis] Failed to create proposal for ${agentId} ${side} ${ticker}:`, e.message);
    return null;
  }
}

export async function getCachedPortfolioTotalValue() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get("pm:portfolio:total-value");
    return raw != null ? Number(raw) : null;
  } catch (e) {
    console.warn("[Redis] Failed to get cached portfolio total value:", e.message);
    return null;
  }
}

export async function setCachedPortfolioTotalValue(value) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set("pm:portfolio:total-value", value);
  } catch (e) {
    console.warn("[Redis] Failed to set cached portfolio total value:", e.message);
  }
}

const MARKET_SCANS_KEY = "pm:market-scans:latest";
const MARKET_SCANS_STATUS_KEY = "pm:market-scans:status";
const MARKET_SCANS_TTL = 24 * 3600;

export async function getCachedMarketScans() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(MARKET_SCANS_KEY);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get cached market scans:", e.message);
    return null;
  }
}

export async function setCachedMarketScans(payload) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(MARKET_SCANS_KEY, JSON.stringify(payload), { ex: MARKET_SCANS_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to cache market scans:", e.message);
  }
}

export async function getMarketScanStatus() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(MARKET_SCANS_STATUS_KEY);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get market scan status:", e.message);
    return null;
  }
}

export async function setMarketScanStatus(status) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(MARKET_SCANS_STATUS_KEY, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }), { ex: MARKET_SCANS_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to set market scan status:", e.message);
  }
}

// Circuit breaker state (lib/circuit-breaker.js) — high-water mark + last tier,
// persisted so drawdown is measured across restarts and tier CHANGES can Telegram.
const HWM_KEY = "pm:hwm:portfolio";
const BREAKER_STATE_KEY = "pm:breaker:state";

export async function getPortfolioHighWaterMark() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(HWM_KEY);
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch (e) {
    console.warn("[Redis] Failed to get portfolio high-water mark:", e.message);
    return null;
  }
}

export async function setPortfolioHighWaterMark({ value, basis }) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(HWM_KEY, JSON.stringify({ value, basis, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn("[Redis] Failed to set portfolio high-water mark:", e.message);
  }
}

export async function getBreakerState() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(BREAKER_STATE_KEY);
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch (e) {
    console.warn("[Redis] Failed to get breaker state:", e.message);
    return null;
  }
}

export async function setBreakerState(state) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(BREAKER_STATE_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn("[Redis] Failed to set breaker state:", e.message);
  }
}

// Weekly review artifacts — scorecards + lessons per ISO week, so the dashboard
// (or a future monthly job) can read what the weekly loop concluded.
export async function setWeeklyReviewArtifact(isoWeek, artifact) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`pm:weekly-review:${isoWeek}`, JSON.stringify(artifact), { ex: 90 * 24 * 3600 });
  } catch (e) {
    console.warn("[Redis] Failed to store weekly review artifact:", e.message);
  }
}

// News dedup — avoid re-fetching Tavily results for the same ticker within a day
const NEWS_CACHE_TTL = 12 * 3600;

export async function getCachedNews(ticker) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`pm:news:${ticker}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get cached news:", e.message);
    return null;
  }
}

export async function setCachedNews(ticker, results) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`pm:news:${ticker}`, JSON.stringify(results), { ex: NEWS_CACHE_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to cache news:", e.message);
  }
}

// Universe catalog (lib/universe.js) — several thousand entries, so it's stored
// in chunks to stay under Upstash request-size limits regardless of plan tier.
// Persistent (no TTL): a missed nightly refresh must not erase weeks of paced
// sector enrichment. pm:universe:status is small and informational.
const UNIVERSE_META_KEY = "pm:universe:meta";
const UNIVERSE_CHUNK_PREFIX = "pm:universe:catalog:";
const UNIVERSE_STATUS_KEY = "pm:universe:status";
const UNIVERSE_CHUNK_SIZE = 1000;

export async function getUniverseCatalog() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const metaRaw = await redis.get(UNIVERSE_META_KEY);
    const meta = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw;
    if (!meta?.chunks) return null;
    const chunks = await Promise.all(
      Array.from({ length: meta.chunks }, (_, i) =>
        redis.get(`${UNIVERSE_CHUNK_PREFIX}${i}`).then((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
      )
    );
    const catalog = {};
    for (const chunk of chunks) {
      if (!chunk) return null; // missing chunk = torn write — treat as no catalog rather than a silently partial one
      Object.assign(catalog, chunk);
    }
    return catalog;
  } catch (e) {
    console.warn("[Redis] Failed to get universe catalog:", e.message);
    return null;
  }
}

export async function setUniverseCatalog(catalog) {
  const redis = getRedis();
  if (!redis) {
    console.error("[Redis] NOT CONFIGURED — universe catalog NOT persisted; scans will fall back to seed watchlists.");
    return;
  }
  try {
    const tickers = Object.keys(catalog).sort();
    const chunkCount = Math.max(1, Math.ceil(tickers.length / UNIVERSE_CHUNK_SIZE));
    for (let i = 0; i < chunkCount; i++) {
      const chunk = {};
      for (const t of tickers.slice(i * UNIVERSE_CHUNK_SIZE, (i + 1) * UNIVERSE_CHUNK_SIZE)) chunk[t] = catalog[t];
      await redis.set(`${UNIVERSE_CHUNK_PREFIX}${i}`, JSON.stringify(chunk));
    }
    // Meta last. A crash mid-write can leave a mixed old/new catalog until the
    // next refresh — acceptable for advisory discovery data (each entry is still
    // internally consistent; money paths never read this).
    await redis.set(UNIVERSE_META_KEY, JSON.stringify({ chunks: chunkCount, tickers: tickers.length, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.error("[Redis] Failed to set universe catalog:", e.message);
    throw e;
  }
}

export async function getUniverseStatus() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(UNIVERSE_STATUS_KEY);
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get universe status:", e.message);
    return null;
  }
}

export async function setUniverseStatus(status) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(UNIVERSE_STATUS_KEY, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn("[Redis] Failed to set universe status:", e.message);
  }
}

// Macro snapshot — shared across every ticker in a scan and changes slowly, so cache across runs too.
const MACRO_CACHE_TTL = 6 * 3600;

export async function getCachedMacro() {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get("pm:macro");
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn("[Redis] Failed to get cached macro snapshot:", e.message);
    return null;
  }
}

export async function setCachedMacro(snapshot) {
  const redis = getRedis();
  if (!redis || !snapshot) return;
  try {
    await redis.set("pm:macro", JSON.stringify(snapshot), { ex: MACRO_CACHE_TTL });
  } catch (e) {
    console.warn("[Redis] Failed to cache macro snapshot:", e.message);
  }
}

// Lab single-ticker research runs (POST /research-ticker): progress/result the
// dashboard polls while the pipeline runs. Short TTL — these are ephemeral run
// records, not history (the durable trail is the agent tab row + the proposal).
const LAB_RESEARCH_TTL = 3600;

function labResearchKeyFor(requestId) {
  return `pm:lab-research:${requestId}`;
}

export async function setLabResearchStatus(requestId, record) {
  const redis = getRedis();
  if (!redis) {
    // This record is the lab run's OUTPUT surface — dropping it silently would
    // leave the dashboard polling a requestId that never resolves.
    console.error(
      `[Redis] NOT CONFIGURED (UPSTASH_REDIS_REST_URL/TOKEN missing) — lab research status DROPPED: ${requestId} (${record?.agentId} ${record?.ticker}, status ${record?.status})`
    );
    return null;
  }
  try {
    await redis.set(labResearchKeyFor(requestId), JSON.stringify(record), { ex: LAB_RESEARCH_TTL });
    return record;
  } catch (e) {
    console.error(`[Redis] Failed to store lab research status ${requestId} (${record?.status}):`, e.message);
    return null;
  }
}

export async function getLabResearchStatus(requestId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(labResearchKeyFor(requestId));
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn(`[Redis] Failed to read lab research status ${requestId}:`, e.message);
    return null;
  }
}
