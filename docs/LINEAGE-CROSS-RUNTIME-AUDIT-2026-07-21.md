# Cross-Runtime Proposal Lineage Audit — 2026-07-21

**Status:** Packet C substantive audit; read-only, no v2 implementation  
**Scope checked:** current Portfolio Manager offline worktree, current Portfolio
Dashboard, and its Mac companion script.

## Current writer and consumer matrix

| Source / path | Current writer | Current readers / consumers | v2 state | Required reader-first change and no-go |
| --- | --- | --- | --- | --- |
| Scheduled discovery | jobs/research-scan.js -> lib/redis.js#createProposal | backend list/expiry, dashboard approvals, Mac companion | legacy allocation lineage | Compiler must attach immutable intent/evidence fingerprint before any v2 writer. No-go if a scheduler writes v2 before every reader accepts both versions. |
| Lab path | jobs/research-scan.js#researchTickerForAgent -> same backend writer | same shared queue and consumers | legacy allocation lineage | Preserve source/intent identity distinct from scheduled discovery. No-go if Lab can synthesize a v2-looking proposal without compiler routing. |
| Exit monitor | jobs/monitor-positions.js -> lib/redis.js#createProposal | same shared queue and consumers | legacy allocation lineage | Revalidate originating specialist, cited lots, and owned share ceiling. No-go for any unmatched or unattributed lot. |
| Intraday stop | jobs/intraday-monitor.js -> lib/redis.js#createProposal | same shared queue and consumers | legacy allocation lineage | Preserve alert source and lot ownership. No-go if a v2 SELL lacks a positive strategy-owner ceiling. |
| Manual dashboard | portfolio-dashboard/app/api/proposals/route.ts -> portfolio-dashboard/lib/proposals.ts#createProposal | dashboard approval store, shared Redis, Mac companion | legacy allocation lineage | Add v1/v2 tolerant dashboard contract mirror before a v2 writer. No-go if dashboard and backend field sets diverge. |

## Shared consumers that must be reader-ready first

- Backend proposal lifecycle: lib/redis.js, lib/proposal-signature.js,
  lib/approval-validity.js, lib/fill-processing.js, jobs/phase0-observer.js,
  and position/holdings reconciliation.
- Dashboard proposal model and approval writer: portfolio-dashboard/lib/proposals.ts,
  portfolio-dashboard/app/contracts/proposal.js, and
  portfolio-dashboard/lib/contracts/signature.js.
- Mac executor: portfolio-dashboard/scripts/mac-companion.mjs. It reads the
  shared Redis proposal, verifies the shared decision signature before broker contact,
  verifies the SELL ownership ceiling, records a fill, and only then marks fulfillment.

The dashboard signature contract already names the backend, dashboard, and companion
as three consumers. The frozen v2 design adds strategyProposalFingerprint and
signatureVersion, but no current writer, reader, signature payload, migration, or
cross-runtime compatibility vector implements them.

## Confirmed gaps and release blockers

1. **No v2 parser or reader exists** in backend, dashboard, or companion; adding a
   v2 writer now would strand at least one consumer.
2. **No outstanding-v1 disposition inventory exists.** Before enforcement, enumerate
   approved v1 records read-only and mark each expire or reject; do not convert one
   in place.
3. **No v2 compatibility vectors exist** for null max price, pipe delimiters,
   changed fingerprint/tampering, or v1 byte-for-byte verification. Existing v1
   signature tests are useful but are not v2 coverage.
4. **No source has a compiler writer yet.** The inventory is complete only as a
   planning list; every source remains legacy allocation lineage.
5. **No cross-runtime rollback proof exists.** Rollback must disable the last v2
   writer while all readers retain verified v1/v2 read compatibility.

## Reader-first implementation order

1. Define v2 contract fields and fixture vectors in the backend canonical contract.
2. Mirror and test v1/v2 parsing in the dashboard; test the Mac companion against
   the same bytes without broker access.
3. Add read-only outstanding-v1 inventory and disposition evidence.
4. Add compiler routing one source at a time in this order: scheduled discovery,
   Lab, exit monitor, intraday stop, manual dashboard.
5. Run cross-runtime contract, forged-lineage, ownership, fill-attribution,
   idempotency, and rollback tests before enabling any writer.

This audit is a no-go finding, not authority to start the migration.
