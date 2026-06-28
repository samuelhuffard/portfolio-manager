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

function proposalKeyFor(id) {
  return `pm:approval_proposal:${id}`;
}

export async function getProposalById(proposalId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(proposalKeyFor(proposalId));
    return typeof raw === "string" ? JSON.parse(raw) : raw;
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
    if (proposal.fulfilledAt && proposal.fulfilledTradeId !== tradeId) throw new Error("Proposal is already fulfilled.");
    proposal.fulfilledAt = now;
    proposal.fulfilledTradeId = tradeId;
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
  if (!redis) return null;

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
    createdByUserId: "system:research-scan",
    createdByEmail: null,
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    fulfilledAt: null,
    fulfilledTradeId: null,
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
