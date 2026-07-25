Sell-side discipline — human-readable narrative of the deterministic exit rules.

This file is NOT read by the AI and is not loaded by any job. Exit decisions for
Agent Three stay fully deterministic by design (lib/mandate-policy.js). This
file exists so a human reviewer can confirm the code still matches the mandate
without reading the branching logic directly. If this narrative and the code
ever disagree, the code (and its tests) is what actually runs — fix whichever
one is wrong and update the other in the same change.

Source of the real thresholds: config/agents/mandate-policy.js, agent-3 entry
(`exit` and `cadence` blocks). Source of the real logic:
lib/mandate-policy.js, evaluateHoldingTriggers(), the agent-3 (else) branch.

Monitoring cadence:
- Every attributed holding is checked each completed trading session, rescored
  weekly, and re-underwritten annually or after a material event.

Exit triggers (current thresholds):
- Structural full-exit trigger (moat erosion, structural share loss, value-
  destructive capital allocation, management credibility failure, restatement,
  bankruptcy, delisting, financing crisis, or failed re-underwrite) ->
  SELL_FULL.
- Business-evidence score (ex-valuation) below 65 at annual/event
  re-underwrite -> REVIEW_REQUIRED.
- Position drift above 25% of portfolio -> SELL_PARTIAL (trim toward target).
- Valuation in the top decile historically (>= 90th percentile) ->
  SELL_PARTIAL (trim/review). A valuation extreme normally supports a trim,
  not an automatic full exit.
- Critical credibility event -> SELL_FULL, always, overriding everything else.

Absolute prohibitions:
- Do not sell solely because price fell.
- SELLs must identify only Agent Three-owned lots.
