// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Single source of truth for the allocation-proposal shape that crosses the
// backend / dashboard / Mac-companion boundary. See ./README.md.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enumerations and limits (previously duplicated as bare Sets/consts per repo)
// ---------------------------------------------------------------------------

/** Research agents permitted to author proposals. */
export const AGENT_IDS = ["agent-1", "agent-2", "agent-3"];

/** Proposal lifecycle states. */
export const PROPOSAL_STATUSES = ["Pending", "ApprovedForBrokerReview", "Rejected", "Expired"];

/** Trade sides a proposal may request. */
export const PROPOSAL_SIDES = ["BUY", "SELL"];

export const MAX_PROPOSALS = 250;
export const MAX_AMOUNT_DOLLARS = 10000;
export const PROPOSAL_EXPIRY_MS = 48 * 60 * 60 * 1000;
export const CURRENT_PROPOSAL_CONTRACT_VERSION = 2;

/** Default risk summary applied when the author leaves it blank. */
export const DEFAULT_RISK_SUMMARY = "Manager reviewed standard sizing and liquidity constraints.";

// A ticker: leading letter, then up to 9 more of [A-Z0-9.-]. Matches the
// dashboard's historical regex exactly.
export const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const AgentIdSchema = z.enum(AGENT_IDS);
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const ProposalSideSchema = z.enum(PROPOSAL_SIDES);

// ---------------------------------------------------------------------------
// Canonical stored proposal
// ---------------------------------------------------------------------------

/**
 * The full persisted proposal, as stored in Redis and consumed by the executor.
 * `.parse()` this on read so a malformed/legacy row fails loudly instead of
 * flowing into the money path (mistake class 5: never trust a stored shape
 * structurally).
 */
export const ProposalSchema = z.object({
  id: z.string().min(1),
  agentId: AgentIdSchema,
  ticker: z.string().regex(TICKER_RE),
  side: ProposalSideSchema,
  amountDollars: z.number().finite().positive(),
  maxPrice: z.number().finite().positive().nullable(),
  // Version 2 binds SELL execution to the proposing strategy's verified
  // open-lot shares. Both fields stay optional so already-approved legacy
  // proposals retain their original signature payload and remain readable.
  proposalContractVersion: z.literal(CURRENT_PROPOSAL_CONTRACT_VERSION).optional(),
  sellOwnerShareLimit: z.number().finite().positive().nullable().optional(),
  rationale: z.string(),
  riskSummary: z.string(),
  status: ProposalStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  createdByUserId: z.string(),
  createdByEmail: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByUserId: z.string().nullable(),
  decisionNote: z.string().nullable(),
  fulfilledAt: z.string().nullable(),
  fulfilledOrderId: z.string().nullable(),
  fulfilledShares: z.number().nullable(),
  // HMAC over the trade-relevant fields, attached at approval. See
  // ./signature.js for the canonical payload; the executor verifies it.
  decisionHmac: z.string().nullable(),
});

/**
 * @typedef {z.infer<typeof ProposalSchema>} Proposal
 * @typedef {z.infer<typeof AgentIdSchema>} AgentId
 * @typedef {z.infer<typeof ProposalStatusSchema>} ProposalStatus
 * @typedef {z.infer<typeof ProposalSideSchema>} ProposalSide
 */

// The trade-defining subset a proposal author supplies. Everything else
// (id, status, timestamps, decision/fulfillment fields, signature) is assigned
// by the system, never by the author.
export const PROPOSAL_AUTHOR_FIELDS = [
  "agentId",
  "ticker",
  "side",
  "amountDollars",
  "maxPrice",
  "rationale",
  "riskSummary",
];

/**
 * Execution-time compatibility gate for the signed owner-share ceiling.
 *
 * Legacy non-SELL proposals retain their historical behavior. Every SELL must
 * carry the v2 ceiling; already-approved legacy SELLs fail closed rather than
 * falling back to the dangerous account-wide ticker position.
 *
 * @param {{ side?: unknown, proposalContractVersion?: unknown, sellOwnerShareLimit?: unknown }} proposal
 * @returns {{ ok: true, legacy: boolean } | { ok: false, legacy: false, reason: string }}
 */
export function checkSellOwnerShareLimitForExecution(proposal) {
  if (String(proposal?.side ?? "").toUpperCase() !== "SELL") {
    return { ok: true, legacy: proposal?.proposalContractVersion == null };
  }
  if (proposal?.proposalContractVersion == null) {
    return {
      ok: false,
      legacy: false,
      reason: "SELL has no signed strategy-owner share ceiling",
    };
  }
  if (proposal.proposalContractVersion !== CURRENT_PROPOSAL_CONTRACT_VERSION) {
    return {
      ok: false,
      legacy: false,
      reason: `unsupported proposal contract version ${proposal.proposalContractVersion}`,
    };
  }
  if (!Number.isFinite(proposal.sellOwnerShareLimit) || proposal.sellOwnerShareLimit <= 0) {
    return {
      ok: false,
      legacy: false,
      reason: "v2 SELL has no valid signed strategy-owner share ceiling",
    };
  }
  return { ok: true, legacy: false };
}

// ---------------------------------------------------------------------------
// Input validation
//
// Kept as an explicit imperative validator (rather than a raw Zod .parse) so the
// user-facing error strings stay byte-identical to what the dashboard has always
// returned. The Zod schemas above own the *shape*; this owns the *input contract*
// and its messages. A parity test pins both to the legacy behavior.
// ---------------------------------------------------------------------------

function toFinitePositiveNumber(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Validate raw proposal-author input. Returns the same discriminated result the
 * dashboard has always returned:
 *   { ok: true, value }  — value is the normalized author-field subset
 *   { ok: false, error } — a human-facing message
 *
 * @param {{ agentId?: unknown, ticker?: unknown, side?: unknown, amountDollars?: unknown, maxPrice?: unknown, rationale?: unknown, riskSummary?: unknown }} input
 * @returns {{ ok: false, error: string } | { ok: true, value: { agentId: string, ticker: string, side: "BUY" | "SELL", amountDollars: number, maxPrice: number | null, rationale: string, riskSummary: string } }}
 */
export function validateProposalInput(input) {
  const agentId = cleanText(input.agentId);
  if (!AGENT_IDS.includes(agentId)) return { ok: false, error: "Select a valid agent." };

  const ticker = cleanText(input.ticker).toUpperCase();
  if (!TICKER_RE.test(ticker)) return { ok: false, error: "Enter a valid ticker." };

  const side = cleanText(input.side).toUpperCase();
  if (side !== "BUY" && side !== "SELL") return { ok: false, error: "Side must be BUY or SELL." };

  const amountDollars = toFinitePositiveNumber(input.amountDollars);
  if (amountDollars == null) return { ok: false, error: "Amount must be a positive dollar value." };
  if (amountDollars > MAX_AMOUNT_DOLLARS) {
    return { ok: false, error: `Amount cannot exceed $${MAX_AMOUNT_DOLLARS.toLocaleString()} per proposal.` };
  }

  const maxPriceRaw = input.maxPrice === "" || input.maxPrice == null ? null : toFinitePositiveNumber(input.maxPrice);
  if (input.maxPrice !== "" && input.maxPrice != null && maxPriceRaw == null) {
    return { ok: false, error: "Max price must be blank or a positive number." };
  }

  const rationale = cleanText(input.rationale);
  if (rationale.length < 12) return { ok: false, error: "Rationale must explain the setup." };
  if (rationale.length > 2000) return { ok: false, error: "Rationale is too long." };

  const riskSummary = cleanText(input.riskSummary, DEFAULT_RISK_SUMMARY);
  if (riskSummary.length > 2000) return { ok: false, error: "Risk summary is too long." };

  return {
    ok: true,
    value: {
      agentId,
      ticker,
      side,
      amountDollars: Math.round(amountDollars * 100) / 100,
      maxPrice: maxPriceRaw == null ? null : Math.round(maxPriceRaw * 100) / 100,
      rationale,
      riskSummary,
    },
  };
}
