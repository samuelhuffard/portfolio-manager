Sell-side discipline — human-readable narrative of the deterministic exit rules.

This file is NOT read by the AI and is not loaded by any job. Exit decisions for
Agent One stay fully deterministic by design (lib/mandate-policy.js). This file
exists so a human reviewer can confirm the code still matches the mandate
without reading the branching logic directly. If this narrative and the code
ever disagree, the code (and its tests) is what actually runs — fix whichever
one is wrong and update the other in the same change.

Source of the real thresholds: config/agents/mandate-policy.js, agent-1 entry
(`exit` and `cadence` blocks). Source of the real logic:
lib/mandate-policy.js, evaluateHoldingTriggers(), the agent-1 branch.

Monitoring cadence:
- Every attributed holding is checked each completed trading session, rescored
  weekly, and re-underwritten after earnings or a material event.

Exit triggers (current thresholds):
- ATR ladder (distance below the 20-session high): >= 2.5 ATR -> SELL_FULL
  (unless the EPS trend is improving and there is no fundamental break);
  >= 2.0 ATR with relative strength broken -> SELL_PARTIAL; >= 1.5 ATR ->
  REVIEW_REQUIRED.
- Fundamental full-exit trigger -> SELL_FULL (critical).
- Momentum deterioration trigger -> SELL_PARTIAL.
- Dead-trade clock (no thesis progress, no catalyst within 10 trading days):
  >= 40 trading days -> SELL_FULL; >= 30 days -> SELL_PARTIAL; >= 20 days ->
  REVIEW_REQUIRED.
- Conviction tier dropped by >= 1 tier -> SELL_PARTIAL.
- Critical credibility event -> SELL_FULL, always, overriding everything else.

Absolute prohibitions:
- Never widen a stop, turn a failed short-clock thesis into a long-term hold,
  or sell another specialist's lots.
