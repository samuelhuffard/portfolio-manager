# Phase 1 Offline Baseline — Mandates, Ownership, and Decision Contracts

**Status:** offline working record; not deployable on its own
**Created:** 2026-07-20
**Baseline:** `f36b388` (`main` / `mandate-v3` at start)
**Scope:** Phase 1 inventory and decision preparation only. This document changes no runtime policy, signature, proposal, approval, execution, or deployment behavior.

## Why this starts Phase 1

Phase 0 observes the current supervised system. Phase 1 must make the future system's investing mandates and proposal lineage precise before any durable research-record or canonical-compiler work is activated.

The work divides cleanly into two parts:

| Work | Authority needed | Current state |
| --- | --- | --- |
| Proposal-source, approval, ownership, and contract inventory | Builder / reviewer | Begun here |
| Q-001–Q-004 investing definitions | Sam + investing partner | Open; no rule will be invented |
| Agent 4 objective and limits | Sam + investing partner | Requires explicit policy version |
| Signature-v2 payload and legacy-v1 disposition | Security / contract review | Must be frozen before implementation |

The canonical compiler and the migration to lineage-bound v2 proposals are **Phase 5 implementation work**. This Phase 1 baseline deliberately does not alter `contracts/pipeline.js`, `lib/redis.js`, dashboard contracts, or the signature scheme.

## Proposal-source inventory

Every current path below produces the same legacy allocation proposal (`lib/redis.js#createProposal` on the backend or the dashboard's matching writer). There is no privileged proposal source.

| ID | Entry point | Intent source | Current writer | Owner / SELL protection | Lineage state |
| --- | --- | --- | --- | --- | --- |
| `scheduled-discovery` | `jobs/research-scan.js` scheduled candidate loop | `scheduled-discovery` | Backend `createProposal` | BUY sized against shared available cash | Legacy allocation only |
| `lab` | `researchTickerForAgent` in `jobs/research-scan.js` | `lab` | Same backend `createProposal` through the shared candidate-review path | Same gates and sizing as scheduled discovery | Legacy allocation only |
| `exit-monitor` | `jobs/monitor-positions.js` | `exit-signal` | Backend `createProposal` | Requires verified strategy-owned shares and passes `sellOwnerShareLimit` | Legacy allocation only |
| `intraday-stop` | `jobs/intraday-monitor.js` | `alert` | Backend `createProposal` | Requires verified strategy-owned shares and passes `sellOwnerShareLimit` | Legacy allocation only |
| `manual-dashboard` | `../portfolio-dashboard/app/api/proposals/route.ts` from the approvals UI | `manual` | Dashboard `lib/proposals.ts#createProposal` | Human-authenticated dashboard input; no canonical research lineage yet | Legacy allocation only |

Agent 4 is intentionally absent: its approved boundary is evaluator/allocator only; it cannot originate, amend, or force a trade.

### Inventory evidence

- Backend writer: `lib/redis.js#createProposal`.
- Scheduled and Lab shared path: `jobs/research-scan.js#reviewCandidateForAgent` and its writer call.
- Mandatory exit path: `jobs/monitor-positions.js`.
- Intraday alert path: `jobs/intraday-monitor.js`.
- Dashboard manual route: `../portfolio-dashboard/app/api/proposals/route.ts` and `../portfolio-dashboard/lib/proposals.ts`.
- Existing ownership regression evidence: `tests/ownership-enforcement.test.js`, `tests/holding-monitor-ownership.test.js`, and `tests/sell-owner-share-ceiling.test.js`.

## Current contract versus accepted target

ADR 0004 accepts the target architecture:

```text
ResearchIntent → EvidenceSnapshot → immutable StrategyProposal
  → AllocationProposal(strategyProposalId + fingerprint)
  → signature v2 → executor
```

`contracts/pipeline.js` currently provides additive schemas for `ResearchIntent`, `StrategyProposal`, and `OrderIntent`, but production does not emit or require them. The live allocation record remains the legacy lifecycle object.

The following target fields are not yet represented as a persisted, immutable, linked proposal record:

- strategy-proposal ID and immutable content fingerprint;
- mandate ID and version;
- evidence timestamp and immutable evidence content;
- thesis variant view, target weight, score/basis/completeness, and peer/fallback metadata;
- evaluator run ID, verdict, revision count, and evaluated fingerprint;
- structured SELL lot shares and remaining target weight;
- creation/expiry timestamps on the immutable strategy record;
- `signatureVersion`, `strategyProposalId`, and `strategyProposalFingerprint` on the live allocation record.

This is a known implementation gap, not a license to silently alter signature v1. New writers must not create v2 until readers, dashboard, companion, persistence, and rollback proof support it together.

## Ownership baseline

The current runtime has already established the following safeguards:

- a SELL must use a verified open-lot share ceiling for the proposing agent;
- unattributed legacy lots are quarantined rather than used as an ownership top-up;
- holding and exit monitoring reconcile strategy ownership;
- Agent 4 can evaluate a proposal but cannot create or force one.

Phase 1 still needs an auditable inventory of existing BUY lots and any outstanding legacy approvals before a v2 cutover decision. No legacy signature may be converted in place.

## Required decisions before Phase 1 can exit

1. Record answers to Q-001 through Q-004 in `docs/RESEARCH-DECISION-REGISTER.md` using the companion worksheet.
2. Version Agent 4's objective, virtual budget, conflict rules, regime inputs, explanations, and prohibitions.
3. Inspect every outstanding v1 approval and record an explicit `expire` or `reject` disposition before v2 enforcement.
4. Freeze the exact v2 signature payload in ADR 0004 or a successor reviewed ADR; retain v1 read compatibility.
5. Produce a signed/traceable ownership audit for all open lots and quarantine any unresolved legacy inventory.
6. Design scoped service identities and document the removal/compatibility evidence.

## Next offline work packages

- **P1-A — source inventory control:** keep this inventory current and add a non-runtime check that all declared source IDs map to supported `ResearchIntent` sources.
- **P1-B — mandate decision worksheet:** capture policy answers without encoding them in code until accepted.
- **P1-C — v2 freeze packet:** write the payload, compatibility matrix, reader/writer ordering, rollback, and v1 disposition checklist for independent review. No implementation activation.
- **P1-D — ownership audit packet:** enumerate the expected evidence and tests for BUY origin, SELL lot consumption, and legacy quarantine.

## Verification boundary

This record is intentionally offline. Its verification is repository inspection and the focused contract/ownership test suite; it neither contacts Redis nor the broker, reads secrets, creates a proposal, or changes the Phase 0 observation cohort.
