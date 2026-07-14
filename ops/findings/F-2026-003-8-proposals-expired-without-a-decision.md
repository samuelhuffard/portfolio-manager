---
id: F-2026-003
fingerprint: 6900a5548fee
check: approvals
type: approvals
severity: P2
status: ack
firstSeen: 2026-07-05T04:57:44.950Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 4
title: "8 proposals expired without a decision"
---

# 8 proposals expired without a decision

**Check:** approvals · **Severity:** P2

## Evidence

- 2026-07-05T04:57:44.950Z — Sam may not be seeing the approval queue — UX problem, not a code bug

## Fix

2026-07-07 — intraday monitor now Telegrams once per Pending proposal as it enters its final 24h before the 48h expiry (`lib/proposal-nudge.js` + step 4 in `jobs/intraday-monitor.js`, deduped via `pm:proposal-nudge:<id>`), so proposals stop lapsing unseen.
- 2026-07-07T22:35:00.622Z — Sam may not be seeing the approval queue — UX problem, not a code bug
- 2026-07-09T22:35:01.079Z — Sam may not be seeing the approval queue — UX problem, not a code bug
- 2026-07-10T22:35:00.519Z — Sam may not be seeing the approval queue — UX problem, not a code bug

## Current disposition

Acknowledged as a historical approval-queue UX signal, not a live P1 or a failed
money path. The deterministic check now classifies three or more undecided
expirations as P2, while stale Pending proposals receive a 24-hour warning and
approved/Executing stalls remain separate P1 checks. Historical expired rows are
preserved, so their count is not expected to disappear.
