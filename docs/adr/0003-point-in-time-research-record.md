# ADR 0003 — Point-in-Time Research Record and Evidence-Selection Gates

**Status:** Accepted for implementation planning
**Date:** 2026-07-13
**Owners:** Sam (product/investment policy), primary systems reviewer (architecture)

## Context

The current research funnel maintains a broad catalog but performs deep review on a small rotating slate. The local `mandate-v3` work adds deterministic scoring from Yahoo/SEC data, but its initial persistence design stores dated Redis snapshots for 120 days and rescales scores across whatever fields happen to be available.

That is adequate for an inert prototype, but it is not a factor record and cannot safely drive “what changed” selection. A score can change because new coverage appeared, a peer group changed, a source restated history, or scoring code changed. Those are not equivalent to a company’s economics changing.

## Decision

The research system will use five append-only, versioned object types:

1. **UniverseSnapshot** — what securities were known and eligible at a point in time.
2. **EvidenceSnapshot** — source facts and derived values that were available for one ticker at that time.
3. **MandateScoreObservation** — one agent/version’s deterministic score over one immutable evidence snapshot.
4. **ResearchEvent** — a reason-coded comparison between two comparable observations.
5. **ResearchSelectionRun** — which candidates a selection policy chose and displaced in shadow, canary, or live mode.

Postgres is the durable append-only research record. Redis may cache the latest view and bounded operational status; Redis TTL data is never the sole historical evidence.

## Canonical mandates and scope

- `agent_mandates/Agent_One_Mandate_v3.md`, `Agent_Two_Mandate_v3.md`, and `Agent_Three_Mandate_v3.md` are the canonical specialist mandates at version `3.0`.
- All three v3 mandates define a target universe of eligible NYSE/NASDAQ operating-company common equities across eligible sectors.
- Agent 1’s live technology-subvertical screen remains an explicit temporary production restriction. It is not reinterpreted as the v3 mandate universe.
- The production restriction is removed only after standard-sector coverage, special-sector classification/substitutions, and the Phase 2 coverage gate pass.
- Agents 2/3 remain watchlist-sourced until their evidence adapters, canonical proposal lineage, and catalog canary gates pass.

## Version identities

Every observation carries:

- `mandateId` and explicit `mandateVersion`.
- `mandateUniverseVersion` for the target mandate scope and `productionUniversePolicyVersion` for the restriction actually applied to the run.
- `scoringConfigVersion` derived from an explicit semantic label plus a content hash of executable scoring tables.
- `codeRevision` from the deployed Git commit, recorded as provenance rather than used as the semantic version.
- `universeSnapshotId`, `inputSnapshotId`, and `peerSetId`.
- `runId` shared by refresh, enrichment, scoring, event creation, and status.

Markdown headings, file mtimes, branch names, and “latest” pointers are not semantic versions.

## Observation completeness and comparability

Three states are distinct:

1. **Stored:** the calculation ran and the observation is valid enough to retain.
2. **Comparable:** it may be compared with a prior observation for a score delta.
3. **Proposal-actionable:** it satisfies the mandate’s entry requirements and may enter the proposal compiler.

An observation is comparable only when:

- agent, mandate version, scoring version, special-sector method, and metric units match;
- the coverage mask is identical;
- neither observation has stale or unavailable thesis-critical data;
- the comparison records peer-set changes separately; and
- no source restatement or version migration is being mistaken for new company evidence.

An observation with changed coverage is stored with `scoreCause=coverage` but is not research-event eligible. A scoring or mandate version change is stored with `scoreCause=version` and begins a new comparison series.

Partial scores remain useful for data-quality monitoring and research ranking within an identical coverage/version cohort. They are not proposal-actionable unless the mandate’s temporary-rescale rule is satisfied: all thesis-critical fields are present and at least 80 of 100 possible points are available. The current first Agent 1 adapter exposes fewer than 80 available points, so its outputs are research-only even when numerically high.

## Score-cause taxonomy

Every comparison uses one primary cause and preserves all contributing causes:

- `initial`
- `filing`
- `market`
- `estimate`
- `ownership`
- `coverage`
- `peer_set`
- `restatement`
- `version`
- `retry`

Only `filing`, `market`, `estimate`, and `ownership` may be research-event eligible, and only after materiality policy, freshness, completeness, and concentration gates pass. `coverage`, `peer_set`, `restatement`, `version`, `retry`, and `initial` remain observable but cannot displace an AI review slot on their own.

## Freshness semantics

Freshness follows the v3 mandates and source chronology, not a universal arbitrary TTL:

- Price/technicals: latest completed trading session; entry quote and relative volume carry a current timestamp.
- Fundamentals: latest publicly available 10-Q/10-K, with filing/period/retrieval times.
- Material events/guidance: latest earnings release plus an 8-K/current-filing check after the financial-statement date.
- Form 4: latest filing, preserving filing and transaction dates.
- 13F: latest reported quarter, explicitly labeled delayed.
- Estimates: latest successful approved-source snapshot with timestamp.
- Estimate revisions: locally derived from stored snapshots after the mandate’s activation history is satisfied.

Where a mandate does not define a numeric expiry—especially “current” estimate or entry-quote age—the observation records source timestamps and `freshnessState=policy_unresolved`; it does not invent a passing TTL. These policy questions remain in `docs/RESEARCH-DECISION-REGISTER.md`.

## Job sequencing

One locked workflow owns the nightly sequence:

```text
universe refresh
  → metric/EDGAR enrichment
  → peer distributions
  → score observations
  → research events
  → shadow selection
  → final status
```

Independent cron times do not establish dependency. A failed stage prevents downstream stages from being reported as successful. Same-run IDs bind every stage. The workflow is off the money path and cannot create proposals.

## Selection modes

- `shadow`: record the evidence slate and displaced candidates; live research uses the current slate.
- `canary`: replace only an approved number of non-holding ranked slots.
- `live`: evidence policy controls non-holding research selection after the roadmap gate.

Holdings and mandatory risk/exit reviews remain protected in every mode. Selection outputs contain no BUY/SELL action and cannot create proposals.

## Storage and failure policy

- Durable research writes are transactional per run.
- Replaying identical `(runId, agentId, ticker)` content is idempotent.
- Different content under the same identity is a hard conflict.
- A configured durable-write failure marks the research job failed. It may not claim success because Redis contains a partial/latest cache.
- Research tables are additive and separate from money/accounting tables.
- Postgres remains noncanonical for money until the autonomy roadmap’s separate parity/cutover gate.

## Consequences

- More storage and plumbing are required before score changes can select AI reviews.
- The system gains a defensible forward record and can support leakage-resistant historical validation.
- Coverage convergence is visible rather than confused with edge.
- Score and selection policy changes create new series instead of rewriting old meaning.
- Phase 1/2 data collection can proceed without expanding trade authority.

## Rejected alternatives

- **Redis dated snapshots as the factor record:** rejected because of TTL, overwrite, provenance, and query limitations.
- **Treat every score delta as an event:** rejected because coverage, peer, restatement, and version changes create false signals.
- **Score missing fields as zero:** rejected as economically false.
- **Let the LLM repair missing peer/fundamental data:** rejected because deterministic provenance and fail-closed behavior are mandatory.
- **Flip all agents to catalog mode immediately:** rejected because mandate-specific evidence, lineage, and coverage gates are incomplete.
