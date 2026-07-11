// CANONICAL — edit here only. Mirrored to portfolio-dashboard/lib/contracts/ by
// `npm run contracts:sync`; the dashboard's contracts-drift test enforces equality.
//
// Strategy-lot ownership contract. A lot is a parcel of shares opened by a BUY,
// owned by the strategy (agent) that opened it. Roadmap invariant #3: only the
// owning strategy may propose a SELL/reduction of its lots, and realized P&L is
// attributed to the consumed owned lots — never a shared FIFO that erases
// ownership. See ./README.md.

import { z } from "zod";
import { AgentIdSchema } from "./proposal.js";

/** A lot whose opening BUY was never attributed to a strategy (legacy/manual). */
export const LOT_UNATTRIBUTED = "unattributed";

export const LotStatusSchema = z.enum(["OPEN", "CLOSED"]);

/**
 * Who owns a lot: one of the research strategies, or the explicit
 * `"unattributed"` sentinel for pre-ownership / manual lots. `"unattributed"`
 * lots are owned by no strategy, so no strategy may SELL them through the
 * ownership-scoped path — they require an explicit manual/reconciled decision.
 */
export const LotOwnerSchema = z.union([AgentIdSchema, z.literal(LOT_UNATTRIBUTED)]);

/**
 * A strategy lot, matching the shape produced by lib/tax-lots.js `openLot`.
 * `.parse()` on read so a malformed Lots row fails loudly before it reaches
 * SELL accounting.
 */
export const StrategyLotSchema = z.object({
  lotId: z.string().min(1),
  ticker: z.string().min(1),
  openDate: z.string().min(1), // ISO date or the "legacy" sentinel
  agentId: LotOwnerSchema,
  costPerShare: z.number().finite().nonnegative(),
  sharesOriginal: z.number().finite().positive(),
  sharesOpen: z.number().finite().nonnegative(),
  status: LotStatusSchema,
});

/** One lot's contribution to a SELL, matching `consumeLotsFIFO`'s `lotsConsumed`. */
export const LotConsumptionSchema = z.object({
  lotId: z.string().min(1),
  ticker: z.string().min(1),
  sharesConsumed: z.number().finite().positive(),
  costPerShare: z.number().finite().nonnegative(),
  proceedsPerShare: z.number().finite().nonnegative(),
  gain: z.number().finite(),
  agentId: LotOwnerSchema,
});

/**
 * @typedef {z.infer<typeof StrategyLotSchema>} StrategyLot
 * @typedef {z.infer<typeof LotConsumptionSchema>} LotConsumption
 * @typedef {z.infer<typeof LotOwnerSchema>} LotOwner
 */
