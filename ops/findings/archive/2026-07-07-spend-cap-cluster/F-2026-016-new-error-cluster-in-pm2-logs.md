---
id: F-2026-016
fingerprint: dfbd385d8853
check: logs
type: bug
severity: P2
status: open
firstSeen: 2026-07-07T22:35:00.622Z
lastSeen: 2026-07-07T22:35:00.622Z
occurrences: 1
title: "New error cluster in PM2 logs"
---

# New error cluster in PM2 logs

**Check:** logs · **Severity:** P2

## Evidence

- 2026-07-07T22:35:00.622Z — 1× "The following result did not validate with schema: #/definitions/QuoteSummaryResult"

## Analyst note (2026-07-07)

lib/yahoo.js wraps the yahoo-finance2 package (confirmed in package.json); this is that library's own known multi-line QuoteSummaryResult schema-validation warning, split by the sentinel's log-cluster check into one finding per line (F-2026-016 through 023 are all fragments of a single console warning).

**Next step:** Fix the sentinel's log-clustering in lib/sysloop/checks.js to group multi-line console warnings into one cluster instead of one per line; separately confirm yahoo-finance2 validation errors aren't silently dropping quote data in lib/yahoo.js.

**Severity suggestion:** P3 (analyst; deterministic severity P2 stands until Sam edits it)
