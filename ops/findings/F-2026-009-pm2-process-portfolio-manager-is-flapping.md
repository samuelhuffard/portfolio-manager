---
id: F-2026-009
fingerprint: e463cf01f22e
check: pm2
type: infra
severity: P2
status: open
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

**Next step:** Check `pm2 describe portfolio-manager` restart count and timestamps now, and confirm whether the uncommitted health-check fix resolves the crash loop before deploying.
