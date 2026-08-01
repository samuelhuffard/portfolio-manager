# TODO

Personal follow-up list for Sam. Not a system-loop artifact (see `ops/FIXLIST.md`
for those) — just things to come back to.

> **Branch note (2026-08-01):** this file does not exist on `mandate-v3`; it lives
> only on `main`, which also carries three further items (holdings reassessment
> cadence, Agent 4 trust-distribution start timing, single-red Tier-2 size cap).
> Fold those in when `main` and `mandate-v3` are reconciled — see the divergence
> write-up in `docs/BRANCH-DIVERGENCE-2026-08-01.md`.

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
