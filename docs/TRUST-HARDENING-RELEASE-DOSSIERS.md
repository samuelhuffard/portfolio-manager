# W5 — Trust-Hardening Release Dossiers

**Status:** design-only; each item is a separate S1/S2 release candidate  
**Boundary:** none of these changes may enter the R1 research/measurement release.

## 1. Authenticated operational evidence — S2

- **Threat:** unauthenticated/replayable receipts, heartbeats, job history, or
  restart baselines can create false observer confidence.
- **Contract:** authenticated, replay-resistant record with issuer, key ID, payload
  hash, issued/expiry time, nonce, and verification result.
- **Migration/rollback:** reader-first validation; dual observation; reject issuer
  fallback only after coverage proof; rollback preserves verified prior records.
- **Evidence/clock:** forged/replay/cross-run tests plus signed observer proof.
  Changes observer pass/fail meaning and reset effect must be declared before deploy.

## 2. Operational-key retirement — S1

- **Threat:** operational keys used for long-lived signing blur privilege and make
  revocation/forensics weak.
- **Contract:** dedicated signing key required, key epoch bound to records, explicit
  historical legacy scope, and no operational-key fallback.
- **Migration/rollback:** reader support for bounded legacy epoch, re-sign/attest
  procedure where allowed, retirement verification, and tested restoration path.
- **Evidence/clock:** dedicated-key absence, forged legacy fallback, rotation, and
  recovery tests. Requires explicit safety-clock reset decision.

## 3. Fresh valuation controls — S1

- **Threat:** stale or mismatched quotes can corrupt breaker, sizing, concentration,
  and parity conclusions.
- **Contract:** content-bound quote identity/source/as-of/retrieved timestamps;
  stale/missing/conflicting values become `UNKNOWN` and block new BUYs.
- **Migration/rollback:** dual-read comparison, explicit stale-state rendering, and
  fallback to the former validated read path only under an incident procedure.
- **Evidence/clock:** stale, future, cross-source, and quote-content mismatch tests;
  breaker and sizing drill proof before any canonical use.

## 4. Financial-truth cutover — S1

- **Threat:** a time-based Postgres promotion can misstate capital-flow performance
  or hide divergence.
- **Contract:** signed capital-flow attribution; event/drill-based parity gate,
  named divergence arbiter, auto-freeze, rollback, and provider-native recovery.
- **Migration/rollback:** reader-first dual read, contribution/withdrawal/fill/NAV
  drills, durable signed divergence decisions, and tested restore from provider
  records. Elapsed time alone is insufficient.
- **Evidence/clock:** money-math, ledger signature, parity, crash/recovery, and
  restore drills. This is independently reviewed and explicitly reset-bearing.

