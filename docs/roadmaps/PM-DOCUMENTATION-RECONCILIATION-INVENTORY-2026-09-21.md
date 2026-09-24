# PM documentation reconciliation inventory

**Status:** prepared 2026-09-21; do not apply the runtime wording below until
the reviewed operational release is deployed and verified. This is an
inventory, not a change to investment policy or a claim that a staged patch is
live.

## Runtime wording that will need revision after release

| Source | Current statement | Verified-runtime replacement condition |
| --- | --- | --- |
| `docs/SYSTEM-LOOP-PLAN.md` §1/§8 | Redis keys are one-shot hard rate caps, checked and set before model work. | Describe a short owner-token in-flight lease, a durable success marker written only after completion, and the bounded retry/attempt rule. Preserve the invariant: no overlapping work and no more than the configured attempts. |
| `docs/RUNBOOK.md` Sysloop entry | `--force` bypasses the once-per-period Redis rate cap. | Say that `--force` bypasses an existing success marker and attempt cap but not an active in-flight lease; document the Mac wake catch-up and Monday recovery of a missed Sunday reporting period. |
| `docs/CHANGE_MAP.md` Sysloop entry | Deploy notes mention the Mac restart but not post-sleep recovery or lease semantics. | Add the release verification sequence: confirm a successful marker only follows a completed child, an unsuccessful child can retry within bounds, and a completed weekly report uses its intended Sunday as-of date. |

## Research-status wording that must wait for the integrated job return

| Source | Current gap | Required evidence before edit |
| --- | --- | --- |
| `docs/roadmaps/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` E2.1 | Defines status contracts but does not distinguish a job process completing from a workflow being configured. | A deployed `research-data-refresh` receipt that records stable `outcome` and `outcomeReason`, plus a final sentinel finding for `not_configured`/`degraded` when applicable. |
| `docs/PHASE-0-OBSERVATION.md` | Describes observation completeness but not the backward-looking missing-day index signal. | One verified immutable observation record and a sentinel snapshot proving a missing prior trading day is visible as a P2, without altering TRUST-day semantics. |

## Policy and evidence documents: do not reconcile by assumption

- `docs/RESEARCH-DECISION-REGISTER.md` correctly leaves Q-002, Q-003, and
  Q-009 open. Only add selections after Sam and the investing partner choose
  them; link the exact decision text and versioned tests.
- `docs/roadmaps/portfolio-master-plan.md` correctly says the agent adapters
  follow accepted definitions. Do not change its 95% catalog/evidence target
  into a completion claim until a measured cohort supports it.
- `docs/AGENT-1-COVERAGE-INVENTORY-2026-09-21.md` is the current evidence for
  the 63-point standard-path ceiling. Replace it only with a metric-by-metric
  measured coverage report after a truthful nightly refresh and policy release.

## Release-time documentation checklist

1. Link the deployed commit and production verification evidence; do not use a
   local test result as deployment proof.
2. Update `SYSTEM-LOOP-PLAN.md`, `RUNBOOK.md`, and `CHANGE_MAP.md` together so
   the lease model has one operational description.
3. Update the research-status and Phase 0 text only after observing the exact
   new receipt/sentinel behavior on the live surface.
4. Record catalog restoration as an incident with its prevention rule (no
   production environment in test worktrees), without copying private runtime
   data or secrets into documentation.
