# Phase 0 Daily Observer

The Phase 0 observer is a read-only evidence recorder for the independent TRUST
safety window and SKILL research cohort defined in `docs/portfolio-master-plan.md`.
It does not advance autonomy, repair
records, mutate proposals or ledgers, contact the broker, or redefine investment
performance.

## Runtime

- Scheduled at **8:20 PM ET, Monday–Friday**, after the 8:00 PM Postgres shadow
  parity job and an **8:10 PM final sentinel refresh**. The earlier 6:15 PM
  sentinel remains the timely alert; only a current final snapshot supports the
  end-of-day verdict.
- Manual command: `npm run phase0:observe` is a dry run: it prints the current
  verdict but never persists or notifies. The scheduled path explicitly enables
  persistence; any explicit persistence call is code-locked until 8:20 PM ET so
  partial-day evidence cannot become the immutable record.
- One create-once `phase0-observation-v2` record is stored at
  `pm:phase0-observation:<YYYY-MM-DD>` with a SHA-256 content hash and an HMAC
  using the existing operational-ledger secret chain. Every retained read is
  verified. A second run retains the first matching record; unsigned, modified,
  or conflicting records fail closed. V1 rows remain historical evidence and
  are not silently reinterpreted as V2.
- Redis is a **90-day transport/index**, not permanent storage: the bounded date
  index retains at most 90 dates and both records and index expire after 90 days.
  Before Redis publication, the same signed aggregate record is create-once
  archived under ignored host-local `ops/phase0-observations/<date>.json` (or
  `PHASE0_EVIDENCE_DIR`). That path must be included in host backups; private
  daily files are never committed. The human observation document and signed
  financial/audit ledgers remain the promotion evidence of record.
- Telegram delivery has its own retryable marker. If storage succeeds but the
  alert fails, the next run retains the immutable observation and retries only
  its Telegram delivery.

## Two independent verdicts

Every check is persisted with an explicit `domain: TRUST | SKILL | BOTH`. The
builder emits:

- `trustVerdict` and `countsTowardSafetyWindow` for the consecutive safety clock;
- `skillVerdict` and `countsTowardResearchCohort` for versioned research samples;
- an overall summary (`PASS_BOTH`, `TRUST_PASS_SKILL_FAIL`,
  `TRUST_FAIL_SKILL_PASS`, `FAIL_BOTH`, or `SKIP`) that never replaces the two
  authoritative clock fields;
- separate `trustReasons` and `skillReasons`, plus versioned `skillProgress`.

TRUST checks are deployment identity and start date, every due money/control
critical job, every expected
scheduled invocation, both sentinel runs, reconciliation, transactional parity,
and valuation/holding-monitoring safety. Daily bounded histories require all five
holdings receipts, the reconciliation receipt, all 14 intraday slots, and both
sentinel slots. Histories retain every attempt, but a retry is judged by the final
retained attempt for that exact invocation: a valid recovered retry satisfies the
slot, while a final failed or malformed attempt remains blocking. Successful
broker-read receipts must pass the shared schema and prove the pinned account-policy
version.
The deployment date must predate the observation date. This enforces the master
plan rule that the deployment day itself cannot count and the first eligible day
is the next trading day.
Each due monitor must conserve `held = monitored + explicitly degraded + failed`
with zero failed, overflow, or silent skips, and exact degradation/failure reason
totals. Aggregate reasons make degradation visible without persisting tickers.

SKILL checks include research-scan and performance-review job completion,
research outcome accounting, proposal-count readability, and
actionable proposal/evaluator throughput. Monthly cost governance is `BOTH`
readiness: `NOT_CONFIGURED`, invalid pricing, or unreadable telemetry leaves G0
insufficient. Once governance is configured, ordinary monthly/provider exhaustion
is SKILL-only. It also fails TRUST only when evidence explicitly says protected
holding/evaluator monitoring was deprived on that observation date. Month-to-date
denial totals remain visible without poisoning later clean safety days. A SKILL failure never invalidates an
otherwise clean TRUST day. Conversely, a TRUST failure never discards a valid
versioned research sample.

`countsTowardResearchCohort` means the run supplied at least one fresh, conserved,
failure-free current-version research outcome. A HOLD-only run can therefore add
valid cohort samples while `skillVerdict` remains `FAIL` because actionable
proposal throughput is still zero. Readable queue counts alone never establish a
valid SKILL sample. Sunday's explicit Friday-close replay is retained exactly
once on Monday. A valid Sunday sample is not erased by a missing or failed Monday
run, but it cannot satisfy Monday's required cadence. Consumed run IDs are read
only from retained HMAC-verified observations. On Friday, the latest Thursday run
may remain visible context, but it is explicitly `newSample: false` and cannot be
counted again.

The record also includes the deployed branch/commit, mandate versions, research
selection policy/mode, active Agent 4 policy version when present, aggregate
proposal-queue counts, research attempts/outcomes, confirmed proposal-producing
evaluator approvals, evaluator rejects, evaluator errors, and a privacy-safe UTC
month-to-date Anthropic cap/telemetry/pricing/headroom summary. The evaluator
approval count is deliberately labeled as confirmed: the current aggregate
research status proves an approval when a proposal was created, but does not yet
claim that this is every evaluator approval in the run.

## Fail-closed boundaries

- Missing, unreadable, malformed, stale, or unclassifiable evidence never passes
  the clock whose evidence it belongs to; it does not contaminate the other clock.
- Provider quota headroom and protected-monitoring impact are named injected
  evidence slots because the current provider API does not expose them directly.
  Unknown quota is visible; unknown/unpriced capacity becomes a TRUST failure only
  when the monitoring-impact slot says protected monitoring was actually lost.
- The legacy position parity digest combines shares/cost fields with
  `marketValue`. A position-only mismatch is therefore `insufficient` for
  transactional parity and a valuation warning, not proof that accounting broke.
- `NON_COMPARABLE`, `PROVENANCE_MISMATCH`, and `FRESHNESS_MISMATCH` valuation
  results remain visible warnings but do not block a day whose transactional
  parity passes. A same-snapshot `VALUE_MISMATCH` blocks. `UNREADABLE` remains
  a warning unless the evidence explicitly says the unreadable valuation also
  prevented holding monitoring; that combined failure blocks the day.
- Scheduled ledger verification now throws into the scheduler wrapper when its
  diagnostic returns `false`; a signature problem can no longer be recorded as
  a successful job merely because the verifier returned instead of throwing.
- Audit-log verification fails closed on Redis read errors and malformed rows;
  an unavailable day can no longer look like an empty, clean audit log.
- Scheduled MCP broker reads use an invocation-specific FIFO. A retrying request
  cannot coalesce away later holdings slots; each slot retains its own durable
  request, account-bound receipt, and final-attempt verdict.
- Terminal research history is idempotent by `runId`: an identical terminal
  replay is ignored and a conflicting terminal outcome fails instead of adding
  a second history row.
- The observer does not infer that a human made no manual ledger repair. Any
  required human attestation remains in the human observation record; automated
  evidence is eligibility evidence, not unilateral promotion authority.

## Operational interpretation

`TRUST PASS` means the automated safety evidence for that date is eligible to
count even when SKILL is failing. `countsTowardResearchCohort: true` preserves
valid research samples even when TRUST fails. Neither field by itself declares
Phase 0 complete: the source-of-truth roadmap still requires both the 10-day
safety window and cumulative proposal/evaluator gates.
Any later-discovered contradictory evidence invalidates the date in the human
record rather than rewriting the immutable automated observation.
