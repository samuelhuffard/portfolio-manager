# Trust Release Blueprint Addendum — 2026-07-21

**Status:** Packet E design review input; all four changes remain separately held  
**Base dossiers:** [TRUST-HARDENING-RELEASE-DOSSIERS.md](TRUST-HARDENING-RELEASE-DOSSIERS.md)

| Candidate | Affected surfaces / records to audit before code | Required negative proof | Rollout / rollback | State |
| --- | --- | --- | --- | --- |
| Authenticated operational evidence | jobs/phase0-observer.js; lib/phase0-observer.js; lib/operational-ledger.js; operational receipts, heartbeat, job-history and restart-baseline records | forged issuer, replayed nonce, expired record, cross-run receipt, missing key | reader-first dual observation; rollback preserves already-verified records; declare observer-clock reset before deploy | not-ready |
| Operational-key retirement | lib/proposal-signature.js; lib/operational-ledger.js; environment key resolution and legacy signature rows | absent dedicated key, legacy-key fallback, wrong epoch, forged historical row, rotation/recovery | dual verifier with bounded legacy scope; never in-place rewrite; verified key restoration drill | not-ready |
| Fresh valuation controls | lib/quote-snapshot.js; lib/circuit-breaker.js; lib/risk-engine.js; pricing/sizing/concentration consumers | stale, future, mismatched symbol/share class, cross-source conflict, content-hash mismatch | dual read with UNKNOWN rendering; incident-only former-path fallback; breaker/sizing drill | not-ready |
| Financial-truth cutover | lib/pg/dual-write.js; lib/pg/parity-runner.js; lib/pg/inventory.js; ledger, lots, fills, capital and NAV records | contribution/withdrawal/fill/NAV divergence, tampered ledger, crash mid-write, restore mismatch | reader-first dual read; event-count parity gate; auto-freeze and provider-native restore drill | not-ready |

Each candidate needs one accountable owner, one independent reviewer, a named
production-evidence source, and an explicit S1/S2 clock decision before it can move
to ready-for-separate-design-review. None may be combined with Packet A, R1 research,
or the observation candidate merely for convenience.
