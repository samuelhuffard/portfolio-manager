---
id: F-2026-094
fingerprint: d27951bdf7af
check: companion
type: infra
severity: P2
status: open
firstSeen: 2026-07-10T22:35:00.519Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 1
title: "Companion heartbeat never seen"
---

# Companion heartbeat never seen

**Check:** companion · **Severity:** P2

## Evidence

- 2026-07-10T22:35:00.519Z — pm:companion:last-seen missing

## Analyst note (2026-07-10)

pm:companion:last-seen is written by the Mac executor (portfolio-executor via ../portfolio-dashboard scripts/mac-companion.mjs per docs/RUNBOOK.md:82), which lives outside this repo and outside what I can verify read-only. firstSeen/lastSeen in the finding file show only 1 occurrence as of 2026-07-10T22:35, consistent with either the Mac process being asleep/offline or never started.

**Next step:** On the Mac, check `pm2 status portfolio-executor` and `pm2 logs portfolio-executor --lines 20` to confirm the process is running and successfully writing the heartbeat key to Redis; restart it if stopped or crash-looping.
