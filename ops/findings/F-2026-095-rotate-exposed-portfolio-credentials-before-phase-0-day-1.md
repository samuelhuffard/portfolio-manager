---
id: F-2026-095
fingerprint: 5e76eca847f8
check: security
type: security
severity: P1
status: open
firstSeen: 2026-07-15T03:32:21.000Z
lastSeen: 2026-07-15T03:32:21.000Z
occurrences: 1
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

**Next step:** Complete the coordinated rotation, run `npm run ledgers:verify`, verify one signed approval and the Phase 0 observation ledger, record sanitized proof below, then set this finding to `fixed` and regenerate `ops/FIXLIST.md`.

## Resolution

Open. Deadline: before the first Phase 0 Day 1 is allowed to count.
