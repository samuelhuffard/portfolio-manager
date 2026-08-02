# Branch divergence: `main` vs `mandate-v3` (2026-08-01)

**Status: OPEN — needs an owner decision.** Read-only investigation, requested by Sam
after a session discovered the two branches had drifted. Nothing here has been merged
or reconciled.

## Summary

`main` and `mandate-v3` split at `f36b388` (2026-07-20) and have since diverged in
**both directions**. Neither is a superset of the other.

| | head | date | commits the other lacks |
|---|---|---|---|
| `origin/main` | `77b4c1f` | 2026-07-25 | 8 |
| `origin/mandate-v3` | `717b03f` | 2026-08-01 | 20+ |

**132 files differ (72 of them code), roughly +2,966 / −673 lines.**

`CLAUDE.md` names `mandate-v3` as the release branch ("do not assume `main`"), and the
master plan records the deployed runtime on it. But `main` is where several recent
changes landed, and `mandate-v3` is still receiving commits (its head is dated today).
The master plan's claim that "`origin/mandate-v3` and `origin/main` now share the same
current documentation/evidence head" was true on 2026-07-14 and is **no longer true**.

## Finding 1 — the deployed branch is missing the deterministic macro gate (P1)

`lib/macro-regime.js` exists on `main` and **does not exist on `mandate-v3`**.

It arrived in `main` commit `40807d2`, *"Enforce the dual-red macro gate deterministically
instead of trusting AI self-certification."* Its accompanying `tests/macro-regime.test.js`
is likewise main-only.

Every analyst mandate states that SPY-below-200-day **and** 10-year-rate-pressure both
red means `NO_TRADE`. On `mandate-v3` — the branch the master plan says is deployed —
that condition is not deterministically enforced; it relies on the model self-certifying
from raw numbers in its prompt. That is precisely the failure mode `40807d2` was written
to close.

**This should be verified against the live runtime before anything else here is acted on.**
If production is genuinely running `mandate-v3` without `lib/macro-regime.js`, the gate is
advisory in production today.

## Finding 2 — the agent mandate split is main-only

`main` carries the per-agent mandate split (`config/agents/agent-{1,2,3}/master.md`,
`buy-playbook.md`, `sell-playbook.md`, plus `MANDATE-SPLIT-PILOT.md`) from commits
`3946d54` and `f377d14`. None of it is on `mandate-v3`, which instead has
`config/agents/agent-{1,2,3}/personality.md` — a file `main` does not have.

So the two branches describe agent behaviour through **different, non-overlapping
document sets**. Any statement of the form "the mandate says X" is branch-dependent
right now.

## What each branch has that the other does not

**Only on `mandate-v3`** (the release branch):

- `lib/peer-coverage.js`, `jobs/peer-bench.js`, `jobs/peer-coverage-refresh.js` — peer
  cohort widening, a proactive peer research bench, and cohort capacity accounting
- `lib/agent4-shadow-adapter.js`, `config/agent-4/shadow-policy.v1.json`
- `lib/research-decision-audit.js`, `lib/proposal-audit-export.js` — redacted audit export
  and historical decision backfill
- `jobs/market-scan-requests.js`
- `config/agents/agent-{1,2,3}/personality.md`
- `config/phase0-operator-exceptions.json`
- Schema-bound research output; evidence-first proposal dossiers; fail-closed broker
  execution rejection
- Hardened `lib/yahoo.js`: schema validation kept failing closed, `extractMarketCap`
  fallback chain

**Only on `main`:**

- `lib/macro-regime.js` + tests — the deterministic dual-red gate (**Finding 1**)
- The agent mandate split (**Finding 2**)
- `ac6e422` — fix for a systemic 200-day / 50-day / 52-week-high data gap
- `lib/mandate-policy.js` refactor moving hardcoded exit thresholds (ATR 2.5/2.0/1.5,
  dead-trade 40/30/20) into config (`policy.exit.*`, `policy.cadence.*`). `mandate-v3`
  still has the literals inline.
- `docs/roadmaps/` reorganisation and `todo/TODO.md` (neither exists on `mandate-v3`;
  the master plan lives at `docs/portfolio-master-plan.md` there)

## Risk

1. **Deploy ambiguity.** `CLAUDE.md` says deploy `mandate-v3`. If a fix lands on `main`
   it never reaches production, silently. `40807d2` and `ac6e422` are both safety-relevant
   and both currently main-only.
2. **"The code says X" is now ambiguous.** Agent behaviour, exit thresholds, and mandate
   documents all differ by branch.
3. **Reconciliation cost grows.** 132 files already. `mandate-v3` received commits today,
   so the gap is still widening.
4. **Concurrent authorship.** `mandate-v3` commits `717b03f` ("docs: add shared agent
   context") and `0769988` ("Clarify shared Redis collaborator boundary") suggest another
   person or agent is working there now. Any reconciliation should be coordinated, not
   unilateral.

## Recommendation

1. **Confirm what is actually deployed** — check the Jetson's loaded commit against both
   branch heads. Every judgement below depends on this and it cannot be checked from a
   sandbox.
2. **If production lacks `lib/macro-regime.js`, treat that as the priority** and port
   `40807d2` (and likely `ac6e422`) to `mandate-v3` on its own, ahead of any wider merge.
3. **Pick one trunk and say so in `CLAUDE.md`.** The present split — "develop wherever,
   deploy `mandate-v3`" — is what produced this.
4. **Reconcile in themed batches**, not one merge: safety fixes → mandate documents →
   config refactors → docs/roadmap moves.
5. Until then, **base new work on `mandate-v3`**, since that is what deploys. (This
   session's work was initially based on `main` and has been rebased onto `mandate-v3`
   for exactly this reason.)

## How this was found

The container's clone had not fetched remote branches, so `git branch -a` showed only
`main`; `mandate-v3` was invisible and work was started on `main`. A `git fetch origin`
surfaced it. **Fetch before branching** — the local clone's branch list is not proof of
what exists on the remote.
