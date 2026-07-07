---
id: F-2026-003
fingerprint: 6900a5548fee
check: approvals
type: approvals
severity: P2
status: fixed
firstSeen: 2026-07-05T04:57:44.950Z
lastSeen: 2026-07-05T04:57:44.950Z
occurrences: 1
title: "8 proposals expired without a decision"
---

# 8 proposals expired without a decision

**Check:** approvals · **Severity:** P2

## Evidence

- 2026-07-05T04:57:44.950Z — Sam may not be seeing the approval queue — UX problem, not a code bug

## Fix

2026-07-07 — intraday monitor now Telegrams once per Pending proposal as it enters its final 24h before the 48h expiry (`lib/proposal-nudge.js` + step 4 in `jobs/intraday-monitor.js`, deduped via `pm:proposal-nudge:<id>`), so proposals stop lapsing unseen.
