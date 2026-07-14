---
id: F-2026-009
fingerprint: e463cf01f22e
check: pm2
type: infra
severity: P2
status: fixed
firstSeen: 2026-07-07T22:35:00.622Z
lastSeen: 2026-07-07T22:35:00.622Z
occurrences: 1
title: "PM2 process portfolio-manager is flapping"
---

# PM2 process portfolio-manager is flapping

**Check:** pm2 · **Severity:** P2

## Evidence

- 2026-07-07T22:35:00.622Z — 10 restarts since last snapshot

## Analyst note (2026-07-07)

10 PM2 restarts since last snapshot; recent uncommitted work on scheduler.js/server.js (health-endpoint blocking fix for slow/unreachable Athena, per recent commits) suggests this may already be the issue being fixed. Verify against current PM2 uptime/restart count before acting — this is point-in-time.

**Historical verification requested:** Check `pm2 describe portfolio-manager` restart count and timestamps now, and confirm whether the uncommitted health-check fix resolves the crash loop before deploying.

## Resolution (2026-07-14)

Live PM2 verification found `portfolio-manager` online with
`unstable_restarts=0` and `exit_code=0`. All observed restarts were correlated to
controlled deploy or environment-update restarts, not a crash loop. Raw PM2 log
timestamps were enabled and persisted separately as part of the gate-closing
release. Any future unexplained restart remains a Phase 0 failure.
