# No-Human-Gate Offline Release Dossier

**Date:** 2026-07-24  
**Scope:** local-only execution of the no-human-gate plan  
**Release authority:** none; this is not a merge, deployment, or promotion request.

## Evidence summary

| Packet | Result | Change class | Runtime effect |
| --- | --- | --- | --- |
| N1 — Bench-30 intake | Intake validator and machine-readable hold report added. The retained corpus remains **0/30**, so `mayCallItBench30=false`. | D/R2 local tooling | None |
| N2 — lineage audit | Pure v2 byte-vector serializer/digest and static direct-writer audit added. It tests null price, pipe rejection, tampering, declared writers, and an undeclared bypass. | D / Phase 5 preparation | None |
| N3 — record rehearsal | Existing durable-writer tests cover transaction/replay/failure behavior; a separate append-only in-memory rehearsal proves fixture replay without a scheduler or database import. | R2 local-only | None |
| N4 — Agent 4 laboratory | Existing twelve-case deterministic lab covers all specialists and authority-negative fields. No numeric fixture value is treated as policy. | D / Phase 1 preparation | None |

## Reproduction

Focused packet verification:

```sh
node --test tests/bench30-intake.test.js tests/proposal-lineage-v2-audit.test.js \
  tests/offline-research-record-rehearsal.test.js tests/offline-research-fixtures.test.js \
  tests/proposal-source-inventory.test.js tests/agent4-paired-shadow-lab.test.js \
  tests/agent4-shadow-policy-cases.test.js tests/pg-research-observations.test.js
```

Result: **23/23 passed** on 2026-07-24, including the rehearsal wrapper.

Actual frozen-writer audit:

```sh
node scripts/audit-proposal-writers.mjs
```

Result: all five declared writer paths were found; no undeclared direct writer was
reported.

Full backend verification:

```sh
npm test
```

Result: **886/886 passed** on 2026-07-24.

## Boundary verification

- `git diff --check` passed.
- The new N1/N2/N3 modules have no imports of jobs, server, Redis, Sheets,
  Telegram, AI/model, evaluator, risk, signature, or MCP modules; they contain no
  network fetch, proposal creation, or message send call.
- The new N1/N2/N3 files contain no sensitive identifier/value matches in the
  scoped secret scan.
- N4 records prove `liveApprovalHmac`, `orderIntent`, `queueMutation`, and
  `cashReservation` are null.

## Intentionally held work

1. Real Bench-30 evidence remains blocked until a permitted, locally retained T0
   packet with source receipt/hash exists. Empty slots remain explicit holds.
2. v2 readers, migrations, writers, v1 dispositions, and cross-runtime rollback
   proof remain Phase 5 work. This dossier adds no production contract or signer.
3. Agent 4 numeric limits, duplicate-thesis treatment, and Sam-disagreement policy
   remain `policy_unresolved` and cannot be activated from fixtures.
4. No production migration, vendor intake, paid call, model call, restart, or
   deployment is included.

## Later release decisions

Before any merge or deploy, a reviewer must classify each selected file again. N1,
N2, and the rehearsal wrapper may remain local tooling; they must not be bundled with
signature, proposal, scheduler, or financial changes. A real corpus intake needs a
separate permitted-source decision. Any v2 reader/writer path needs a coordinated
backend/dashboard/companion, reader-first S1 review and explicit rollback proof.
