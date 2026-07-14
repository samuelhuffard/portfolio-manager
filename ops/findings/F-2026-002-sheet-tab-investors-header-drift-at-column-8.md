---
id: F-2026-002
fingerprint: fad8703c7602
check: sheets
type: sheets
severity: P1
status: fixed
firstSeen: 2026-07-05T04:57:44.950Z
lastSeen: 2026-07-05T04:57:44.950Z
occurrences: 1
title: "Sheet tab \"Investors\" header drift at column 8"
---

# Sheet tab "Investors" header drift at column 8

**Check:** sheets · **Severity:** P1

## Evidence

- 2026-07-05T04:57:44.950Z — expected "Investor ID", got "(missing)" — schema is duplicated across repos, fix all copies

**Sam 2026-07-05:** acknowledged — do not action for now (NVDA approval is pre-signing historical; Investors headers will be extended before any real contribution is recorded).

## Resolution (2026-07-14)

Live sanitized Sheets verification returned an exact 10-of-10 Investors header
match with no sheet anomalies. The signed Investors ledger also verified 7-of-7.
The historical missing-column alert is therefore resolved; any recurrence will
reopen through the deterministic system loop.
