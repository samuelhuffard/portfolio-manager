# Actionable Candidate Dossier — Shadow Layer

## Purpose

The peer-fundamental score remains an attention selector. This shadow-only layer
answers the next question: has a selected, non-holding candidate already cleared
the canonical mandate-observation actionability contract, such that a future full
investment dossier may investigate it?

It is intentionally not a trade gate and not a source of proposal authority.
`readyForDeepResearch` means only that a future, separately reviewed full-dossier
stage may investigate the candidate.

## What is measured

For every shadow-selected, non-protected candidate, the layer validates the
immutable mandate-score observation and reads its canonical `actionable` field.
It does not reimplement actionability. The observation contract owns eligibility,
coverage, available-points, freshness, and score-cause requirements; the current
adapter deliberately pins `actionable: false` until its open policy questions are
resolved.

The resulting aggregate is stored only inside the durable shadow selection-run
payload. It exposes counts and fixed reason codes, never tickers, rationales,
holdings, or portfolio data through status/health surfaces. Invalid or malformed
advisory inputs are counted and cannot abort the selection run.

Because the current production adapter intentionally pins `actionable: false`,
`readyForDeepResearchCount` is expected to remain zero until that policy gate is
separately resolved. The initial 20-day observation period therefore validates
the blocker mix and input health, not a positive readiness rate. An
`assessmentUnavailableCount` item is already included in `blockedCount`; do not
sum those two counts.

## Authority boundary

This layer has no model, proposal, broker, ledger, Redis, or execution dependency.
It does not modify `jobs/research-scan.js`, the active research slate, or a policy
threshold. All candidate records set `proposalEligible: false`.

## Validation plan

Run the existing research-data workflow in its configured `shadow` selection mode.
For at least 20 clean shadow trading days, query `research_selection_runs.payload`
for `selectionPolicy.candidateDossierReadiness`, then inspect the aggregate
readiness rate, invalid-input count, and blocker mix alongside selection overlap
and candidate displacement. Only after the missing human policy decisions and a
separate reviewed promotion gate may a full-dossier builder consume names deemed
ready for deep research.
