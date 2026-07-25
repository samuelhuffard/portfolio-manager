# TODO

Personal follow-up list for Sam. Not a system-loop artifact (see `ops/FIXLIST.md`
for those) — just things to come back to.

- [ ] **Revisit holdings reassessment cadence.** Come back to how often each
      agent's held positions get reassessed (daily exit-monitor at 16:45 ET,
      plus intraday ATR checks for Agent 1) and whether that cadence is still
      right as the portfolio grows. See `jobs/monitor-positions.js`,
      `jobs/intraday-monitor.js`, `scheduler.js`.

- [ ] **Not urgent — revisit Agent 4 trust-distribution start timing.** Currently
      trust starts at a flat 50 for all analysts and stays process-only (zero
      return weight) for a fixed 60-trading-day cold start (`agent_mandates/Agent_Four_Mandate_v3.md`,
      Section 5/10). Explore a metric-driven alternative to that fixed window —
      likely something beta-based (each analyst's portfolio beta vs. its own
      benchmark), then adjust by a multiple to judge how good the returns
      actually are for the time period given, relative to that analyst's
      mandate goals — rather than switching from process-only to performance-
      weighted purely on a calendar trigger.

- [ ] **Wire a real Tier-2 size cap for the single-red macro condition.** As of
      `jobs/research-scan.js`'s deterministic dual-red gate, a single red macro
      condition (SPY below 200-day OR rate pressure, not both) is flagged with a
      mandatory override note but doesn't actually cap position size at Tier 2 —
      Agent 1 has a live conviction/tier clamp (`lib/conviction.js`,
      `assessConviction`) that could enforce this; Agent 2 has no equivalent
      live tier-cap mechanism yet, only the shadow one in
      `config/agents/mandate-policy.js`'s `score.tiers`. Needs that clamp built
      for Agent 2 (and decide whether Agent 3, which treats macro as
      informational only, should be involved at all) before this can be a real
      enforced cap instead of just a flagged note. See the commit that added
      `lib/macro-regime.js` for full context.
