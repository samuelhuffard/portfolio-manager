# Observation-Week Candidate Manifest

**Status:** living local/offline control record; not a release approval  
**Integration branch:** `observation-week-release-2026-07-21`  
**Parity base:** `f36b388` (`main` / `mandate-v3`)  
**Last reconciled:** 2026-07-21  
**Authority:** [Observation-Week Offline Release Plan](OBSERVATION-WEEK-RELEASE-PLAN.md)

## Purpose

This is the exhaustive allow-list for the observation-week integration candidate.
An item can be included only after it has an owner, change class, allowed inputs,
verification command, expected output, and stop condition. A listed item is not
approved for merge, deployment, promotion, or a Phase 0 clock claim.

The branch begins with the two already-reviewed Phase 1 preparation commits on top
of `f36b388`. All later work remains uncommitted until its packet acceptance is
recorded here.

## Included now

| Item | Commit / files | Class | Runtime impact | Verification | Rollback / stop condition |
| --- | --- | --- | --- | --- | --- |
| Phase 1 baseline and five-source inventory | `29cc003`: `docs/PHASE-1-OFFLINE-BASELINE.md`, `docs/PHASE-1-POLICY-WORKSHEET.md`, `lib/proposal-source-inventory.js`, `tests/proposal-source-inventory.test.js` | D | Pure inventory validation only; no proposal writer or runtime policy changes | `node --test tests/proposal-source-inventory.test.js` | Revert the isolated commit; stop if inventory no longer matches current writers |
| Proposal-lineage guardrail | `2afc519`: `.claude/napkin.md` | D | Runbook wording only | Markdown review | Revert the isolated commit; stop if it conflicts with the master plan |
| Planning reconciliation | Uncommitted: `docs/HIGH-LEVERAGE-EXECUTION-PLAN.md`, `docs/OBSERVATION-WEEK-RELEASE-PLAN.md`, and linked master/roadmap/baseline edits | D | Documentation only; does not alter gates or runtime behavior | Markdown-link check, stale-status review, `git diff --check` | Remove any statement that contradicts runtime evidence or changes a master gate |
| W0 release controls | Uncommitted: this manifest and `docs/OBSERVATION-WEEK-RELEASE-NOTES.md` | D | Documentation/control records only | Manifest-to-diff review, Markdown-link check, `git diff --check` | Stop final integration if a changed file is absent from this manifest |
| W1 mandate-freeze contracts | Uncommitted: `config/phase1-mandate-freeze.js`, `tests/phase1-mandate-freeze.test.js`, `docs/PHASE-1-COMPILED-MANDATE-SPECIFICATIONS.md`, and worksheet/release-plan links | D / Phase 1 preparation | Fixture-only diagnostic; no live caller imports it and it emits no proposal | `node --test tests/phase1-mandate-freeze.test.js` | Remove it if a live pipeline imports it or an unresolved policy is replaced with a default |
| Packet A local proposal-quality harness | Uncommitted: `lib/proposal-quality-local.js`, `fixtures/proposal-quality-local-cases.json`, `scripts/proposal-quality-local.mjs`, `tests/proposal-quality-local.test.js`, `docs/PROPOSAL-QUALITY-LOCAL-HARNESS.md` | D / Phase 0 diagnostic | Pure fixture diagnostic; no imports, credentials, output proposal, or mutation | `node --test tests/proposal-quality-local.test.js` and `npm run proposal-quality:local` | Remove if an import, runtime caller, policy threshold, or action-producing output appears |
| W2 measurement/golden-set foundation | **Held at 0/30**: schema, slot shell, and verified gap record exist | D / R2 local-only | Validator is inert; no local raw T0 fact, receipt, or hash exists for any slot | [Packet B hold record](BENCH30-EVIDENCE-HOLD-2026-07-21.md) | Do not represent it as Bench-30 until actual local evidence packets and hashes exist |
| W3 lineage-v2 foundation | **Audited; implementation held**: inventory, freeze, and file-level gap matrix exist | D / high-risk design | No v2 writer, migration, signature implementation, or cross-repo edit | [Packet C audit](LINEAGE-CROSS-RUNTIME-AUDIT-2026-07-21.md) | Do not enable a v2 writer before all named readers, v1 disposition, vectors, and rollback proof exist |
| W4 Agent 4 foundation | **Paired laboratory complete; activation held** | D / Phase 1 preparation | 12 deterministic, authority-free records use the existing pure engine only | [Packet D lab](AGENT4-PAIRED-SHADOW-LAB-2026-07-21.md) and node --test tests/agent4-paired-shadow-lab.test.js | No activation or policy inference from fixture-only values |
| W5 trust dossiers foundation | **Four change maps complete; implementation held** | D / S1-S2 design | Design only; no observer, signing, breaker, quote, or money-path code | [Packet E addendum](TRUST-RELEASE-BLUEPRINT-ADDENDUM-2026-07-21.md) | Keep separate from R1 and require a new safety-release manifest |

## Conditional candidates

| Candidate | Current status | Conditions before inclusion | Reason if held |
| --- | --- | --- | --- |
| Proposal-quality shadow harness (`fbe96f9`) | **Superseded and held** | Use Packet A's separately implemented pure harness; do not revive this import path | The imported module constructs an Anthropic client, so it is not fully disconnected |
| Cadence documentation (`f93f188`) | **Conditional — documentation review** | Reconcile against the five-day observation plan; confirm no scheduler, observer expectation, policy gate, or runtime change | It may contain stale cadence assumptions |

## Held candidates

| Candidate | Class | Hold reason | Reconsider only when |
| --- | --- | --- | --- |
| Fresh-data MU review (`f0cad09`) | R2 / cost-bearing local tool | Calls live data and models; not observation-safe under the offline boundary | Rewritten fixture-only or separately approved for non-production data/model cost |
| R1 evaluator, evidence, or threshold behavior | R1 | Can affect research cohort/approval behavior | Observation verdict is known and a specific cohort/approval-effect review is approved |
| Signature v2 writer or migration | S1 | Changes signatures and proposal lineage enforcement | Coordinated reader-first release, v1 disposition, rollback, and independent security review |
| Observer, receipt, breaker, operational-key, or financial cutover code | S1/S2 | Could reset or alter the meaning of Phase 0 evidence | Separately scoped safety release with explicit reset and rollback |
| Agent 4 runtime decisions | S1 / authority | Shadow-only policy has not earned activation | Phase 4 shadow gates and explicit promotion review |

## Rejected bulk sources

| Source | Disposition | Reason |
| --- | --- | --- |
| `portfolio-manager-observation-offline` branch | **Rejected as a bulk merge source** | It predates the parity baseline and has incompatible history. A single artifact may be re-derived only after a file-level comparison and current-behavior check. |
| `node_modules`, environment files, credentials, generated runtime data, private transcripts | **Rejected** | Never review or stage generated/dependent/secrets-bearing material. |

## Per-item attestation

Before a candidate changes from **conditional** to **included**, append:

| Date | Candidate | Reviewer | Allowed inputs confirmed | Focused test / result | Final status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-21 | Packet A local proposal-quality harness | Codex local verification | Synthetic fixture only; pure module has zero ES-module imports | `node --test tests/proposal-quality-local.test.js` (3/3); `npm run proposal-quality:local` (3 audited, 2 blocked, 1 review-ready) | Included for final integration review | Offline diagnostic only; not a proposal, model run, or observation evidence |

No row means the candidate remains held. “Included” means eligible for final
integration review only; it never means deployed or gate-passing.
