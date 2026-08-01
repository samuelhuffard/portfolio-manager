// Metadata-only W4 cases. No proposal, order, approval key, or live portfolio
// state is included. Policy-dependent cases deliberately remain non-actionable.
export const AGENT4_SHADOW_POLICY_CASES = Object.freeze([
  Object.freeze({ id: "duplicate-thesis", condition: "duplicate_thesis", expectedDisposition: "policy_unresolved_non_actionable" }),
  Object.freeze({ id: "concentration-breach", condition: "ticker_concentration_breach", expectedDisposition: "reject_explainable" }),
  Object.freeze({ id: "stale-portfolio", condition: "stale_portfolio_snapshot", expectedDisposition: "reject_explainable" }),
  Object.freeze({ id: "unowned-sell", condition: "unowned_sell", expectedDisposition: "reject_explainable" }),
  Object.freeze({ id: "budget-exhaustion", condition: "strategy_budget_exhausted", expectedDisposition: "reject_explainable" }),
  Object.freeze({ id: "sam-disagrees", condition: "sam_disagrees", expectedDisposition: "record_only_non_actionable" }),
]);

