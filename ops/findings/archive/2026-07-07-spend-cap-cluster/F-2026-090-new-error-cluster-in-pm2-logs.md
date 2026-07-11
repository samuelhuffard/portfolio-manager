---
id: F-2026-090
fingerprint: c327089d865b
check: logs
type: infra
severity: P2
status: open
firstSeen: 2026-07-09T22:35:01.079Z
lastSeen: 2026-07-09T22:35:01.079Z
occurrences: 1
title: "New error cluster in PM2 logs"
---

# New error cluster in PM2 logs

**Check:** logs · **Severity:** P2

## Evidence

- 2026-07-09T22:35:01.079Z — 1× "[Evidence] agent-2: 1 low-severity evidence flag(s) logged without Telegram: model:BRK-B"

## Analyst note (2026-07-09)

Verified in jobs/research-scan.js:1007-1017 — this console.warn is the deliberate 'logged without Telegram' branch of shouldTelegramEvidenceFlags, confirming the escalation logic worked as designed for a low-severity flag (companion to F-2026-089's same event).

**Next step:** Exclude this expected console.warn line from the log-scan sentinel's error-cluster matching, or add a duplicate-title suppression since 25+ prior findings (F-2026-011 through 035) already cover this same noisy pattern.

**Severity suggestion:** P3 (analyst; deterministic severity P2 stands until Sam edits it)
