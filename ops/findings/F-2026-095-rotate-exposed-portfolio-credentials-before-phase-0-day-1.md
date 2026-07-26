---
id: F-2026-095
fingerprint: 5e76eca847f8
check: security
type: security
severity: P1
status: open
firstSeen: 2026-07-15T03:32:21.000Z
lastSeen: 2026-07-26T21:00:00.000Z
occurrences: 2
title: "Rotate credentials exposed in a private task transcript before Phase 0 Day 1"
---

# Rotate credentials exposed in a private task transcript before Phase 0 Day 1

**Check:** security · **Severity:** P1

## Evidence

- 2026-07-15T03:32:21.000Z — A diagnostic command printed the backend process environment into a private agent task transcript. No credential values are copied into this repository or the synced memory vault.

## Safety impact

Treat every credential that was present in the process environment as exposed. This
finding is deliberately P1 and must remain open until rotation and verification are
complete. The system sentinel carries tracked P0/P1 findings into the Phase 0
observer, so no Phase 0 Day 1 may count while this item is open or acknowledged.

## Rotation order and verification

1. Rotate the Robinhood password and TOTP seed first; verify read-only account access and keep order placement disabled.
2. Rotate the Upstash token; update every backend/dashboard consumer and verify Redis health without printing the token.
3. Rotate the shared webhook secret in a coordinated backend/dashboard release; verify authenticated health and one rejected unauthenticated request.
4. Rotate the Anthropic key; verify budget readiness and one budget-guarded call path.
5. Rotate the Telegram bot token; verify one non-sensitive test alert.
6. Rotate the remaining application and database credentials that were present in the environment, using presence-only checks on each machine.
7. Rotate HMAC signing secrets last and only through the explicit legacy-verification migration path. Re-sign or migrate retained long-lived rows before removing fallbacks; verify Investors, Performance, Trade, Lots, Audit, operational observation history, and one signed approval before retirement.

Do not print secret values during any step. Use presence/length checks only.

**Next step:** Monitor for regression. When the first genuine proposal appears, Sam must personally review and sign it before the normal runtime signature verification and execution gates are exercised.

## Reopened 2026-07-26

A later diagnostic again exposed process-environment credentials to a private
agent transcript. The dedicated MCP receipt key was immediately replaced, but
the remaining provider and signing credentials require a coordinated rotation
and presence-only verification. This finding is deliberately open so Phase 0
cannot count a day before that rotation is complete.

## Resolution

Fixed 2026-07-15/16 before any Phase 0 day had counted.

- Sam confirmed the replacement-credential actions were completed and the exposed revocable credentials were revoked. Presence-only checks confirmed the replacement configuration without printing values.
- Runtime checks proved Redis, Sheets, Anthropic readiness, Telegram delivery, the database connection, and the authenticated webhook path; an unauthenticated webhook request was rejected.
- `npm run ledgers:verify` verified 7/7 Investors, 51/51 Performance, 1/1 Trade, 1/1 Lots, and 5,210 Audit rows with zero unsigned or mismatched rows. The signed Phase 0 observation record also verified.
- No genuine proposal existed, so none was fabricated or approved for closure evidence. A non-persisting signature-contract check passed. The first genuine proposal remains subject to Sam's personal review and signature plus normal runtime verification before execution.
- The credential rotation left seven Postgres `capital_entries.row_hmac` shadow copies signed with the prior investor-ledger key. A fail-closed preview proved 7 authoritative rows and 7 shadow rows with identical non-signature payloads and no missing, duplicate, mismatched, or invalid rows. The one-time transaction changed only those seven shadow HMAC copies using compare-and-swap guards.
- Immediate post-transaction parity returned `MATCH` for `accounting_snapshot`, `capital_entries`, `lots`, `positions`, and `proposals`. Position valuation remained correctly marked `NON_COMPARABLE` because versioned quote provenance was unavailable; it was not reported as a false match.

No secret values were recorded in this finding, repository, logs, or synced memory.
