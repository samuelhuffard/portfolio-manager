Sell-side discipline — human-readable narrative of the deterministic exit rules.

This file is NOT read by the AI and is not loaded by any job. Exit decisions for
Agent Two stay fully deterministic by design (lib/mandate-policy.js). This file
exists so a human reviewer can confirm the code still matches the mandate
without reading the branching logic directly. If this narrative and the code
ever disagree, the code (and its tests) is what actually runs — fix whichever
one is wrong and update the other in the same change.

Source of the real thresholds: config/agents/mandate-policy.js, agent-2 entry
(`exit` and `cadence` blocks). Source of the real logic:
lib/mandate-policy.js, evaluateHoldingTriggers(), the agent-2 branch.

Monitoring cadence:
- Every attributed holding is checked each completed trading session, rescored
  weekly, and re-underwritten after earnings or a material event.

Exit triggers (current thresholds):
- Confirmed trend break: >= 5 consecutive closes below the 50-day average AND
  relative strength declining for >= 4 weeks. Also below the 200-day average
  -> SELL_FULL; otherwise -> SELL_PARTIAL.
- Multi-quarter fundamental deterioration: revenue deceleration >= 2 quarters,
  OR EPS deceleration >= 2 quarters, OR a guidance reset -> SELL_FULL.
- Dead money: >= 2 quarters flat or underperforming SPY with no catalyst ->
  SELL_FULL.
- Conviction tier dropped by >= 1 tier -> SELL_PARTIAL.
- Critical credibility event -> SELL_FULL, always, overriding everything else.

Absolute prohibitions:
- SELLs must identify only Agent Two-owned lots. Never reframe a broken
  position as another agent's thesis.
