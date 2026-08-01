# W3 — Proposal Lineage v2 Freeze

**Status:** Phase 5 design freeze; no writer, migration, or signature change  
**Architecture authority:** [ADR 0004](adr/0004-strategy-proposal-lineage.md)  
**Inventory control:** `lib/proposal-source-inventory.js`

## Frozen signature-v2 bytes

The UTF-8 payload is exactly this pipe-delimited sequence, with no omitted,
reordered, normalized, or JSON-serialized fields:

```text
id|status|agentId|ticker|side|amountDollars|maxPrice|decidedAt|decidedByUserId|strategyProposalFingerprint|signatureVersion
```

The v2 verifier recomputes the immutable strategy-proposal fingerprint and requires
it to equal the signed `strategyProposalFingerprint`. It also verifies the direct
trade fields. v1 bytes remain unchanged for legacy rows; no v1 signature is upgraded
in place.

## Compatibility and migration order

1. Add durable strategy/evidence storage and nullable v2 read fields.
2. Deploy backend, dashboard, and companion readers that read v1 and v2.
3. Verify contract mirrors and cross-runtime projections.
4. Inventory every outstanding approved v1 record; disposition each as `expire` or
   `reject` before v2-only enforcement.
5. Route sources in this order: scheduled discovery, Lab, exit monitor, intraday
   stop, manual dashboard. Verify each independently before the next.
6. Enable v2 writers only after all readers, signatures, rollback, and source tests
   pass. Retain historical v1 read support.

Rollback disables the last v2 writer and returns to verified reader compatibility; it
never rewrites a v2 record into v1 or mutates a signed v1 record.

## Source and ownership controls

The five current sources are inventory-controlled. A new source must declare an
allowed `ResearchIntent` source **and** a compiler-routing plan; otherwise the
offline inventory test fails. Every SELL records its originating specialist and cited
lots. Compiler, approval, and execution each revalidate open shares and ownership;
unattributed inventory remains quarantined.

## Ownership-audit protocol

Use synthetic fixtures during observation, then before a cutover obtain a
signed/traceable snapshot of every open lot. Reconcile aggregate Holdings shares to
the full open-lot book; list agent, ticker, lot ID, shares open, source proposal,
signature version, and quarantine reason. Any unmatched, unattributed, duplicate, or
over-ceiling lot is a no-go until explicitly resolved; no strategy receives it as
implicit ownership.

## Required tests and no-go conditions

Required: contract parity, byte-for-byte signature tests, forged-lineage tests,
source routing, idempotency, ownership, fill attribution, v1 reader compatibility,
and cross-runtime rollback tests.

No-go: unknown source, unsigned/mutable lineage, any v1 in-place conversion, a
dashboard/companion reader gap, undispositioned approved v1 record, unresolved open
lot ownership, or missing rollback proof.

## Cross-repo checklist

Before implementation, confirm the dashboard proposal route, dashboard proposal
store, Mac companion executor, backend Redis lifecycle writer, Postgres research
writer, and contract mirror all have reader-first compatibility. Any mismatch is an
integration finding—not a reason to add a local workaround.
