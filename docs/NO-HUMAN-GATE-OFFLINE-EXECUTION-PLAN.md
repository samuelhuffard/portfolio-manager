# No-Human-Gate Offline Execution Plan

**Status:** authorized planning and local-only work; no production, policy, or
promotion authority  
**Date:** 2026-07-24  
**Parent authority:** [portfolio-master-plan.md](portfolio-master-plan.md)  
**Related plans:** [RESEARCH-ROADMAP-EXECUTION-GUIDE.md](RESEARCH-ROADMAP-EXECUTION-GUIDE.md) and
[OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md](OBSERVATION-PERIOD-OFFLINE-EXECUTION-PLAN.md)

## Purpose

Use the Phase 0 observation period to remove implementation and evidence-shape
unknowns without choosing investing policy, changing the observed runtime, spending
on vendors, or creating a proposal, approval, order, migration, or live Agent 4
decision. This plan deliberately excludes work that requires Sam or an investing
partner to make a substantive policy decision.

It is a work-order, not a new promotion path. The master plan remains the only
authority for phase order, deployment, and autonomy.

## Non-negotiable boundaries

- No production deploy, restart, environment change, database migration, live model
  call, broker call, vendor trial, paid data purchase, or dashboard activation.
- No change to thresholds, prompts, candidate selection, evaluator policy, signing,
  execution, accounting, or Phase 0 observer behavior.
- No synthetic artifact may be labeled a proposal, an organic sample, a benchmark
  result, an observation day, or investment evidence.
- Missing policy is represented as `policy_unresolved`, unavailable, or held. It is
  never filled in with a plausible default.
- Work occurs in an isolated offline worktree. The observed production checkout
  remains untouched.

## Explicit human-gated stop points

These are not tasks in this plan:

1. Q-001–Q-004 mandate rules, including balance-sheet definitions, freshness,
   special-sector handling, and consensus/13F completeness.
2. Any numeric Agent 4 allocation, concentration, cash, gross, or conflict policy.
3. Disposition of any outstanding v1 approval; only Sam may choose `expire` or
   `reject` for an actual record.
4. Paid/vendor data, Athena permission or live intake, production migrations,
   releases, and all authority changes.

## Execution order

### N1 — Bench-30 intake and chronology tooling

**Goal:** make a real point-in-time corpus possible without fabricating the missing
source material.

**Build now**

- Create an intake schema and validator for packet identity, source tier, retained
  receipt location/hash, decision/availability/retrieval times, expected facts,
  missingness, restatement/corporate-action/conflict status, and expected
  disposition.
- Add deterministic validation for `retrievedAt <= decisionTime`, immutable packet
  hashes, share-class identity, duplicate packets, mixed policy versions, future
  facts, and an explicit source-retention requirement.
- Produce a coverage matrix for the required 30 slots and a machine-readable hold
  report for every empty slot.
- Import only already-permitted, locally preserved evidence. If none exists for a
  slot, leave it empty and report the gap; do not fetch data merely to reach 30.

**Done when:** the validator rejects every invalid chronology/provenance case, a
coverage report distinguishes actual packets from empty slots, and no output calls an
incomplete set “Bench-30.”

### N2 — Proposal-lineage compatibility audit and test vectors

**Goal:** remove cross-runtime uncertainty before any signature-v2 writer exists.

**Build now**

- Refresh the inventory of all five proposal sources and their backend, dashboard,
  and companion readers/writers.
- Create byte-level v2 fixtures for delimiters, null limit price, tampering,
  idempotent replay, owned/unowned SELLs, stale evidence, and v1 reader
  compatibility.
- Add a static direct-writer/bypass scan that fails for an undeclared source or
  consumer.
- Write a redacted read-only procedure that produces the outstanding-v1 inventory,
  but stop before assigning a disposition to real records.
- Produce a reader-first rollout and rollback checklist with file-level ownership.

**Done when:** every source and consumer is mapped, all vectors are deterministic,
and the report names any remaining reader, writer, ownership, or rollback gap as a
no-go.

### N3 — Point-in-time research-record rehearsal

**Goal:** prove durable research-record mechanics in disposable local storage, not
production.

**Build now**

- Exercise the existing contracts, deterministic IDs, append-only writer, ordered
  workflow, and report readers against fixtures in an isolated disposable database.
- Test migration idempotency, write failure, replay, same-day rerun, partial
  evidence, coverage change, stale evidence, and version-change outcomes.
- Produce a restore/replay proof that recomputes the same stored observation and
  selection identities from the fixture inputs.
- Verify that no live scheduler, proposal writer, evaluator, money path, or
  dashboard route imports the rehearsal code.

**Done when:** the rehearsal demonstrates deterministic replay and fail-closed
required-write behavior, with a clear production migration/rollback checklist left
unexecuted.

### N4 — Agent 4 paired-shadow laboratory expansion

**Goal:** make future Agent 4 evaluation measurable while preserving zero authority.

**Build now**

- Expand the deterministic paired fixture set to cover all specialists, duplicate
  thesis, stale/mismatched snapshots, cash/gross/concentration/budget failures,
  owned/unowned SELLs, horizon mismatch, and Sam disagreement.
- Require every unresolved numeric/conflict outcome to be recorded as
  `policy_unresolved` or record-only.
- Generate aggregate-only reports: case coverage, deterministic replay, agreement /
  disagreement labels, reason distribution, and prohibited-field proof.
- Add negative tests proving every record has null approval, order, queue, cash
  reservation, and live-allocation fields.

**Done when:** all fixtures replay exactly and no output can be mistaken for a live
approval, allocation, performance result, or promotion recommendation.

### N5 — Offline integration review and release dossier

**Goal:** hand future reviewers a coherent, safe decision packet rather than a
collection of local edits.

**Build now**

- Run focused tests, the full backend suite, import-denylist scans, secret scan, and
  diff check for N1–N4.
- Produce a manifest separating completed evidence, intentionally empty holds,
  human-gated decisions, and production-deferred work.
- Classify every changed file as D, R1, R2, S1, or S2; any ambiguous file takes the
  more conservative class.
- Write release/rollback notes that state exactly which later decision is needed
  before a merge, migration, or deployment.

**Done when:** an independent reviewer can reproduce each local result, find no live
imports or secrets, and decide on the next release without rereading the whole
worktree.

## Recommended sequence and dependencies

1. Start N1 and N2 together; neither requires mandate policy.
2. Run N3 after its existing contract/writer fixtures are identified; keep storage
   disposable.
3. Run N4 independently with only fixture policy.
4. Run N5 only after N1–N4 each have either reproducible evidence or an explicit
   hold record.

## What this improves—and what it does not

This work is expected to improve architecture confidence in research depth, data
provenance, continuity, measurement, and future risk controls. It does **not**
increase demonstrated investment edge, advance the Phase 0 safety clock, authorize
Agent 4, or justify a rating increase based on plans alone. Those require later
deployment and sustained current-version evidence under the master plan.
