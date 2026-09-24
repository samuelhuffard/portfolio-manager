# Portfolio Manager — Remaining Priorities

**Status:** Reconciled working roadmap as of 2026-09-21.  It replaces no
approved mandate or policy decision.  “Ready for review” is not “deployed,” and
no row authorizes trading or loosens the shadow-only boundary.

## Current operating truth

- The production catalog was restored after an isolated-test incident: 2,487
  genuine entries, zero fixture tickers, and 214 sector-enriched entries were
  verified.  The truthful status receipt remains stale until the next real
  nightly refresh; it must not be fabricated.
- No live research observation is complete/actionable: no path currently emits
  `freshnessState: "fresh"`, while the observation adapter marks every metric
  thesis-critical.
- Agent 1 standard-path coverage tops out at 63 points before consensus/13F
  bundles.  Agent 2 tops out at 59 because its multi-quarter persistence inputs
  are deliberately null.  These are evidence gaps, not grounds to lower the
  80-point bar.
- Proposal gating remains off.  No proposed work changes that fact.

## Priority order

### 0. Deploy only the reviewed operational truthfulness release

**Why first:** Before improving research, the system must accurately say when a
workflow did not run, was misconfigured, or monitored no positions.

1. Complete cross-review and integrate the staged baseline-provenance,
   run-outcome, universe-test-isolation, receipt, sentinel, exit-monitor, and
   Sysloop changes in one serial production owner workflow.
2. Fix the remaining test-isolation review finding: every existing fixture path
   invoking `runUniverseRefresh` must inject in-memory/no-op stores.  Injection
   seams alone do not stop a caller from using real defaults.
3. Ensure `runResearchScan()` returns the classified `outcome` and
   `outcomeReason` so `wrapJob()` persists the intended scan receipt instead of
   defaulting to `ok`.
4. Resolve the Tier 2 lease prerequisite: either reconcile the reviewed
   `944046b` success-marker/in-flight-lease work with the new wake recovery, or
   explicitly defer Tier 2 deployment.  Do not deploy a recovery mechanism that
   can lock itself out for eight days after a failed weekly attempt.
5. Claude alone deploys/restarts/verifies.  Verify the exact changed receipts,
   a final sentinel result, exit-monitor coverage handling, the production
   catalog count, and clean startup logs.  A health endpoint alone is not
   release verification.

### 1. Restore and measure catalog/evidence coverage

**Why next:** Agent completeness cannot be inferred from partial catalog counts.

1. Observe the next truthful nightly catalog refresh; record catalog count,
   sector-enrichment count, first-trade-date coverage, peer-metric coverage,
   and stable failure reasons.
2. Repair/continue sector classification as a data pipeline.  Set a measurable
   coverage target before treating it as complete; do not classify a sector from
   model prose.
3. Measure Agent 1’s nine metrics by covered, stale, unavailable, unsupported,
   and policy-unresolved counts.  Separate missing upstream source data from
   an unbound adapter.
4. Retain the restored catalog incident and test-isolation rule as operational
   evidence; never attach a populated production `.env` to a test worktree.

### 2. Decide universal freshness policy (Sam + investing partner)

**Why before Agent 2 persistence:** Q-002/Q-003 determine whether any agent
can truthfully emit `fresh`; without them, completeness is unreachable even if
all points are available.

1. Select Q-002 estimate age, event invalidation, and stale-data consequence.
2. Select Q-003 regular-session quote age, outside-hours treatment, price
   re-review, and material-event invalidation.
3. Record selected wording in the decision register; do not ask an
   implementation agent to invent a threshold.
4. Implement a pure versioned freshness/criticality policy, including Q-004’s
   already-accepted rule that missing 13F remains visible but is not by itself
   actionability-blocking.  Unit-test timestamp, event, unavailable, and
   policy-unresolved boundaries.

### 3. Complete pure evidence adapters after policy is explicit

1. Build the point-in-time consensus adapter for Agent 1 `revBeat` and
   `estimateRevisions`; retain source, as-of, period matching, and explicit
   unavailable reasons.
2. Build the accepted quarterly 13F ownership adapter.  It must use the
   approved ticker-to-CUSIP direction and publication timing; it must not
   manufacture per-ticker history.
3. Decide Q-009 (source, beat materiality, three-quarter persistence, EPS
   basis), then build the pure Agent 2 persistence adapter.  Missing or mixed
   basis data remains null.
4. Claude wires only reviewed pure adapters into scheduled research; repeat
   cross-model review for the integration because it is proposal-adjacent.

### 4. Prove a new research cohort before any gate change

1. Declare a new cohort for each material research policy/evidence release.
2. Observe coverage/freshness distributions, score causes, candidate selection,
   review outcomes, and proposal quality for the required trading-day window.
3. Keep `MANDATE_SCORE_GATES_PROPOSALS` off until the specified evidence window
   and release criteria are met.  Never enable it merely because scores rise.
4. Treat degraded source results as explicit findings, and preserve a human
   approval boundary for every order.

### 5. Reconcile durable documentation only after verified runtime state

1. Update the master roadmap, execution guide, and decision register to remove
   stale claims (including the `mandate-score` boundary description) and link
   each item to current evidence.
2. Record deploy identity, known incidents, policy choices, and measured gate
   evidence—not transient internal chat or raw operational data.
3. Archive superseded planning text only after the new document is reviewed;
   do not delete historical rationale.

## Ownership and review boundary

| Area | Builder | Required reviewer / decision owner |
| --- | --- | --- |
| Live runtime, Redis, scheduler, production deployment | Claude | Codex review; Sam approval where release scope requires it |
| Pure policy/adapters and roadmap reconciliation | Codex | Claude integration review; Sam + investing partner for policy |
| Q-002, Q-003, Q-009 values | — | Sam + investing partner only |
| Orders, approvals, allocation | — | Sam only |

## Completion evidence for this roadmap

The roadmap is not complete because a document says it is.  Each operational
release requires review, two appropriate test runs, a production verification
of the exact behavior, and an immutable observation.  Each research release
also needs the declared cohort evidence described in Priority 4.
