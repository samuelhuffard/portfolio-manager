# Research Roadmap — Delegation Manifest

**Prepared:** 2026-07-13
**Architectural prerequisites:** complete through ADR 0003, ADR 0004, Decision Register rev 2026-07-13, and Backtest Methodology v1.

This folder contains copy-ready task prompts for separate Codex tasks. Sam may select a smaller model for each task. Do not run overlapping waves against the same files without reviewing the dependency table.

## Execution status — 2026-07-13 local worktree

The original Wave A/B/C prompts remain useful as specifications and provenance, but their launch sequencing is now historical. The current worktree contains verified local implementations for Wave A, the Phase 1 spine, E2.1 and safe fail-closed evidence primitives, E3.1–E3.3, the backtest scaffold, E4.1 and shadow-only E4.2, and E7 measurement/persistence/reporting surfaces. The execution guide ledger is the status authority.

Nothing in this manifest means committed, migrated, deployed, activated, empirically validated, or promoted. Do not relaunch a historical packet against the shared worktree. Use `docs/RESEARCH-ROADMAP-EXECUTION-GUIDE.md` section 3.1 as the current status authority.

## Wave A — historical prompts, implementation present locally

These packets were designed to run independently in separate tasks; do not relaunch them against the current shared worktree.

| Task | Suggested Codex model | Main surfaces | Depends on | Merge order |
|---|---|---|---|---|
| `WAVE-A-E0.1-HOLDINGS-ROWS.md` | `gpt-5.4-mini`, high | backend + dashboard Holdings readers/tests | none | any |
| `WAVE-A-E0.2-RUN-REPORT.md` | `gpt-5.6-luna`, high | outcome aggregates in scan + pure report/script/tests | none | any |
| `WAVE-A-E1.1-OBSERVATION-CONTRACT.md` | `gpt-5.6-terra`, high | new canonical contract/tests + generated mirror | ADR 0003 | before E1.2/E1.3 |
| `WAVE-A-E1.4-VERSION-IDS.md` | `gpt-5.4-mini`, high | mandate metadata + pure hashing/tests | D-001/D-002 | before score writer wiring |

These are executor recommendations, not hard requirements. Change the model in each Codex task before sending its packet. Keep E1.1 on the stronger model because cross-field schema refinements are easy to weaken accidentally.

### Shared-worktree warning

The backend already contains user work in:

- `config/agents/agent-3/risk-limits.json`
- `lib/ai-budget.js`
- `lib/mandate-metrics.js`
- `lib/redis.js`
- `package.json`
- `scheduler.js`
- untracked scoring/roadmap files

The dashboard also has unrelated changes under investor/home/chart files. Wave A prompts avoid those paths. Executors must not stage, commit, revert, or reformat unrelated changes.

## Wave B — historical sequencing, implementation present locally

Do not launch these prompts again. E1.1–E1.6 implementations are present locally and awaiting final integrated review.

| Packet | Suggested model | Notes |
|---|---|---|
| E1.2 research migration | Standard | Exact tables from ADR 0003 + accepted contract |
| E1.3 Postgres writer | Standard | Depends on migration and contract |
| E1.5 sequential workflow | Standard | Overlaps current `scheduler.js`, `package.json`, and untracked scoring work; primary reviewer must reconcile first |
| E1.6 health surface | Small/standard | Depends on workflow status shape; touches `lib/redis.js` already modified |

## Wave C — partially implemented locally

- E2.1 coverage accounting: implementation present locally; pending final review.
- E2.2 special-sector classifier: not implemented; taxonomy mapping review remains required.
- E3.1 delta-cause classifier: implementation present locally; Q-005 still blocks live materiality.
- E3.2 research-event migration/writer: implementation present locally; migration/deployment pending.
- E3.3 shadow-slate comparator: implementation present locally; observed shadow evidence pending.

## Later verified local implementations

- Synthetic point-in-time backtest scaffold; Q-007 still blocks populated net results and conclusions.
- E4.1 pure selector and the shadow-recording portion of E4.2; positive canary/live fail closed.
- E7.1 outcome math and additive persistence/readers, E7.2 counterfactuals, and E7.3 aggregate-safe report generation.

## Remaining executor packet

- E7.4 outcome maturation cadence, as specified in the execution guide. Do not schedule it until the primary reviewer freezes ownership, policy inputs, data-source semantics, and deployment/rollback scope.

## Blocked by investment-policy input

- E2.3 Agent 1 balance-sheet bindings: Q-001.
- Estimate/actionability completion: Q-002–Q-004.
- Live score-event materiality: Q-005.
- Cash challenger: Q-006.
- Final net backtest claims: Q-007.
- Proposal-lineage implementation: exact signature-v2 signed payload plus outstanding-v1 approval inventory/disposition.
- Outcome maturation scheduling: primary-reviewer ownership and deployment gate.

## Primary-review checkpoints

After each task:

1. Inspect full diff and pre-existing worktree changes.
2. Run the task verification commands locally.
3. Search for stale copies/bypass paths.
4. Do not deploy or enable flags.
5. Record accepted changes in the roadmap/decision register only after evidence.
