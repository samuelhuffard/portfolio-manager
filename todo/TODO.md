# TODO

Personal follow-up list for Sam. Not a system-loop artifact (see `ops/FIXLIST.md`
for those) — just things to come back to.


- [ ] **AGENT 2 CANNOT PRODUCE AN ACTIONABLE CANDIDATE (Q-009).** Its rule tables read
      eight multi-quarter beat/persistence inputs that nothing derives —
      `lib/mandate-evidence.js` sets them null by design rather than infer four-quarter
      persistence from one scalar. Agent 2 therefore caps at **59** available points,
      below the 80-point bar. Worse, `evaluateCondition` short-circuits `all` on `false`
      but returns `null` on a missing input, so this bites the *strongest* names: a
      company growing >20% reaches the top band, hits the null and scores missing, while
      a mediocre one scores fine. Pinned by `tests/mandate-coverage-ceiling.test.js`.
      Fix is a multi-quarter persistence pass over the same EDGAR series
      `lib/agent3-history.js` already walks.

- [ ] **VERIFY THE TWO EXTERNAL HOSTS FROM THE JETSON.** Neither could be reached from
      the sandbox this work was written in, so both paths are unexercised:
      `curl -sS -o /dev/null -w '%{http_code}\n' -A 'portfolio-manager <email>' \
        https://www.sec.gov/files/dera/data/form-13f-data-sets/2025q1_form13f.zip`
      (expect 200 — sec.gov is already reached by `lib/edgar.js`, so this should pass)
      `curl -sS -X POST https://api.openfigi.com/v3/mapping -H 'Content-Type: application/json' \
        -d '[{"idType":"TICKER","idValue":"AAPL","exchCode":"US"}]'`
      (expect JSON containing AAPL's CUSIP — this host has NEVER been called by this
      repo, so egress may not be permitted). If OpenFIGI is blocked, the fallback is
      deriving a partial ticker→CUSIP map from SEC filings that carry both.

- [ ] **A CATALOG REFRESH MUST LAND BEFORE AGENT 3 SCREENS ANYTHING.** The 3-years-public
      gate reads the new `ftd` field written by `applyQuotes`; it fails closed when
      absent, so until a quote pass repopulates the catalog, Agent 3's screen returns
      empty with `public_history_unavailable` on every name. Expected, but it looks
      exactly like a breakage if you are not expecting it.

- [ ] **REVIEW THE Q-001 BALANCE-SHEET DEFINITIONS THAT ARE NOW LIVE IN SCORING.**
      Sam signed off provisionally on 2026-08-01 so the work could proceed; the
      investing partner has NOT reviewed them. They are implemented in
      `lib/edgar-metrics.js` (`deriveFundamentalMetrics`) and bound in
      `lib/mandate-evidence.js`. Draft + rationale:
      `docs/human-inputs/Q-001-balance-sheet-definitions-DRAFT.md`.
      The four judgement calls to confirm or overrule:
      1. **Profitability** is TTM *operating* income > 0, not net income — so a
         one-time tax/litigation/impairment item cannot flip a structurally
         profitable company into the pre-profit track.
      2. **netCash** excludes restricted cash, and **operating leases are NOT
         treated as debt** (post-ASC-842 they sit on the balance sheet;
         including them would make asset-light retail/restaurant names look far
         more levered than the market treats them). This is the most debatable call.
      3. **EBITDA fallback order** is operating income + D&A, with several
         concept fallbacks; a missing D&A tag yields null rather than an
         approximation from operating income alone.
      4. **Negative or zero EBITDA ⇒ `netDebtEbitda` is null**, never a number.
         Scored naively a negative denominator sorts as "excellent" — this is the
         single most dangerous failure mode in the metric.
      Note: the mandate's own band thresholds were already transcribed in
      `config/scoring/absolute-thresholds.js`, so the bands proposed in the draft
      document were redundant and were NOT used. Only the definitions above are new.
      This changed scoring, so per the master plan's reset rules it opens a new
      research cohort.
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
