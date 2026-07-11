---
id: F-2026-093
fingerprint: e7f0e602cbc0
check: cron
type: bug
severity: P1
status: open
firstSeen: 2026-07-10T22:35:00.519Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 1
title: "Job research-scan did not run today"
---

# Job research-scan did not run today

**Check:** cron · **Severity:** P1

## Evidence

- 2026-07-10T22:35:00.519Z — last ran 2026-07-09 (expected by 18:00 ET)

## Analyst note (2026-07-10)

Same root cause as F-2026-092: scheduler.js:137 schedules research-scan as "15 17 * * 0-4" (Sun-Thu only, explicitly moved off Friday per the comment above it referencing exit-monitor's reasoning). 2026-07-10 is a Friday, so a missed run today is expected behavior, not a failure.

**Next step:** Same fix as F-2026-092 — teach the cron-check the actual Sun-Thu schedule so Fridays don't page as missed runs.

**Severity suggestion:** P3 (analyst; deterministic severity P1 stands until Sam edits it)
