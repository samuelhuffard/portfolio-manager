---
id: F-2026-010
fingerprint: b5fcb95577b7
check: cron
type: unknown
severity: P2
status: fixed
firstSeen: 2026-07-07T22:35:00.622Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 3
title: "Job weekly-review has never recorded a run"
---

# Job weekly-review has never recorded a run

**Check:** cron · **Severity:** P2

## Evidence

- 2026-07-07T22:35:00.622Z — key missing

## Analyst note (2026-07-07)

scheduler.js:169 schedules weekly-review for Fridays 18:30 ET only. Cannot confirm from repo alone how long the job/cron has existed in deployed form or whether a Friday has actually elapsed since it went live; 'never recorded a run' may just mean the first scheduled Friday hasn't occurred yet.

**Historical verification requested:** Check deploy history and Redis for the job's last-run key against the most recent Friday 18:30 ET to confirm whether a run was actually missed.

**Severity suggestion:** P3 (analyst; deterministic severity P2 stands until Sam edits it)
- 2026-07-09T22:35:01.079Z — key missing
- 2026-07-10T22:35:00.519Z — key missing

## Resolution (2026-07-14)

Live Redis verification found a successful weekly-review record for 2026-07-10
at `2026-07-10T22:30:04.943Z` with no error. The historical never-run finding is
resolved; schedule monitoring will reopen it if a future expected run is absent.
