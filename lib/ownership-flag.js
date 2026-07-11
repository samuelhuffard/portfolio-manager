// Single source for whether strategy-lot ownership enforcement is active
// (roadmap invariant #3). When ON, a SELL only consumes its own strategy's lots
// (then unattributed), never another strategy's; an unreconcilable SELL is
// recorded, flagged for reconciliation, and left unfulfilled instead of crossing
// strategies or booking a phantom gain.
//
// Enabled by default now that the Codex-required coverage is in place (MCP
// /record-trade + holdings-sync both handle the reconciliation path, the queue
// fails closed, and records are verified on read). `ENFORCE_OWNERSHIP=false` is
// a kill switch that reverts to the legacy account-wide FIFO WITHOUT a deploy —
// keep it available for a fast rollback if attribution anomalies appear live.
export function ownershipEnforcementEnabled() {
  return process.env.ENFORCE_OWNERSHIP?.trim() !== "false";
}
