# Bench-30 Evidence Hold — 2026-07-21

**Status:** Packet B is held; no local point-in-time corpus exists  
**Authority:** [Substantive Offline Execution Plan](SUBSTANTIVE-OFFLINE-EXECUTION-PLAN.md)

## What was verified locally

- [fixtures/bench30-golden-set.js](../fixtures/bench30-golden-set.js) contains
  exactly 30 synthetic slots, not evidence packets.
- [docs/BENCH30-AND-GOLDEN-SET-FREEZE.md](BENCH30-AND-GOLDEN-SET-FREEZE.md)
  explicitly says the slots contain no retrieved provider values.
- Repository fixtures, backtest inputs, research-evidence files, and the current
  Portfolio Manager vault/review records contain no preserved primary-source receipt,
  raw T0 facts, or receipt hash that can populate one permitted slot.

Therefore the valid corpus size is **0/30**. It must not be described as Bench-30,
an offline evaluation, a vendor bakeoff, an investment result, or Phase 0 evidence.

## Required intake packet for each real slot

Before a slot becomes part of the corpus, commit a local, non-secret evidence packet
containing:

1. security and share-class identity;
2. decision, fact-availability, and retrieval timestamps;
3. source tier, retention/licensing note, and a receipt hash;
4. raw T0 facts plus explicit missingness;
5. restatement, corporate-action, and conflict state;
6. policy/scoring version and a predeclared expected disposition.

The existing fixture validator remains the minimum chronology/fingerprint control;
the intake must add the raw evidence and receipt-hash fields before it can be called
a corpus.

## Authorized next action

Collect and commit T0 facts first, using a separately approved non-production data
path and no production key. Only after that may a vendor, Athena, or model comparison
be run. The first package should prioritize the hard-fail categories already frozen
in the slot manifest: banks, insurers, REITs, stale estimates, restatements,
share-class/corporate-action traps, and future/conflict cases.
