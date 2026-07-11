---
id: F-2026-092
fingerprint: 918b1ad3f3bf
check: cron
type: bug
severity: P1
status: open
firstSeen: 2026-07-10T22:35:00.519Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 1
title: "Job exit-monitor did not run today"
---

# Job exit-monitor did not run today

**Check:** cron · **Severity:** P1

## Evidence

- 2026-07-10T22:35:00.519Z — last ran 2026-07-09 (expected by 17.25:00 ET)

## Analyst note (2026-07-10)

scheduler.js:131 schedules exit-monitor as "45 16 * * 0-4" (Sun-Thu only) — a deliberate change per the code comment (proposal-expiry timing), not Sun-Thu-Fri. 2026-07-10 is a Friday, so no run was ever expected; the cron-check in the sentinel appears to assume a daily schedule and doesn't account for this Sun-Thu window.

**Next step:** Update the sentinel's cron-run-check (lib/sysloop/checks.js) to read expected days from the actual cron expression, or special-case exit-monitor/research-scan as Sun-Thu-only so Friday no longer triggers a false alert.

**Severity suggestion:** P3 (analyst; deterministic severity P1 stands until Sam edits it)
