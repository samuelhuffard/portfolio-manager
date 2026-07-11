// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Typed pipeline objects for the non-negotiable architecture (roadmap):
//   EvidenceSnapshot -> ResearchIntent -> ... -> StrategyProposal -> OrderIntent
//
// v0, ADDITIVE. These define the shapes the canonical compiler and the incoming
// specialist mandates will both consume. Nothing in production emits or requires
// them yet — routing every proposal source through the compiler is a later,
// mandate-coupled change. Landing the shapes now keeps that work, and the
// mandate work, from each inventing their own copy.

import { z } from "zod";
import { AgentIdSchema, ProposalSideSchema, TICKER_RE } from "./proposal.js";

const Ticker = z.string().regex(TICKER_RE);
const Iso = z.string().min(1);

/** Where a research request originated. Every source must be one of these — there
 *  are no privileged shortcuts (roadmap rule #1). */
export const INTENT_SOURCES = [
  "scheduled-discovery",
  "lab",
  "alert",
  "exit-signal",
  "manual",
];
export const IntentSourceSchema = z.enum(INTENT_SOURCES);

/**
 * A request to research a candidate before any proposal exists. `side` is
 * nullable because discovery may be undirected (research the name, then decide).
 * A SELL/exit intent names the ticker it concerns.
 */
export const ResearchIntentSchema = z.object({
  id: z.string().min(1),
  source: IntentSourceSchema,
  agentId: AgentIdSchema,
  ticker: Ticker.nullable(),
  side: ProposalSideSchema.nullable(),
  createdAt: Iso,
  reason: z.string(), // human/agent-readable trigger context
  evidenceRefs: z.array(z.string()).default([]),
});

/**
 * What a specialist emits after its mandate + data-quality + evaluator gates
 * pass: a proposal carrying its lineage and thesis. Superset of the author
 * fields on the stored proposal, plus the machine-readable thesis/kill-criteria
 * the roadmap requires (so exits can be evaluated against a written invalidation,
 * not vibes). A SELL cites the strategy-owned lots it intends to consume.
 */
export const StrategyProposalSchema = z.object({
  intentId: z.string().min(1),
  agentId: AgentIdSchema,
  ticker: Ticker,
  side: ProposalSideSchema,
  amountDollars: z.number().finite().positive(),
  maxPrice: z.number().finite().positive().nullable(),
  thesis: z.string().min(1),
  killCriteria: z.array(z.string().min(1)).min(1), // ≥1 written invalidation
  horizonDays: z.number().int().positive().nullable(),
  evidenceSnapshotId: z.string().min(1),
  citedLotIds: z.array(z.string()).default([]), // required non-empty for SELL, enforced by refinement
}).superRefine((p, ctx) => {
  if (p.side === "SELL" && p.citedLotIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A SELL StrategyProposal must cite the owned lots it consumes." });
  }
});

/**
 * The immutable, authorized order produced when a proposal is approved. Nothing
 * downstream may mutate side/ticker/amount — the executor submits exactly this,
 * with `refId = proposalId` for broker idempotency.
 */
export const OrderIntentSchema = z.object({
  proposalId: z.string().min(1),
  refId: z.string().min(1), // must equal proposalId (checked at construction)
  agentId: AgentIdSchema,
  ticker: Ticker,
  side: ProposalSideSchema,
  amountDollars: z.number().finite().positive(),
  maxPrice: z.number().finite().positive().nullable(),
  approvedAt: Iso,
  decisionHmac: z.string().min(1),
}).superRefine((o, ctx) => {
  if (o.refId !== o.proposalId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "OrderIntent.refId must equal proposalId (broker idempotency)." });
  }
});

/**
 * @typedef {z.infer<typeof ResearchIntentSchema>} ResearchIntent
 * @typedef {z.infer<typeof StrategyProposalSchema>} StrategyProposal
 * @typedef {z.infer<typeof OrderIntentSchema>} OrderIntent
 */
