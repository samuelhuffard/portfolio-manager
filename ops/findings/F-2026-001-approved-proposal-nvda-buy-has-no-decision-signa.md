---
id: F-2026-001
fingerprint: ba810c1db81c
check: lifecycle
type: lifecycle
severity: P1
status: fixed
firstSeen: 2026-07-05T04:57:44.950Z
lastSeen: 2026-07-10T22:35:00.519Z
occurrences: 4
title: "Approved proposal NVDA BUY has no decision signature"
---

# Approved proposal NVDA BUY has no decision signature

**Check:** lifecycle · **Severity:** P1

## Evidence

- 2026-07-05T04:57:44.950Z — id=d3fa3417-66f8-49fa-a3bb-83cbe044ef71 — executor must refuse this; find out how it got approved unsigned

**Sam 2026-07-05:** acknowledged — do not action for now (NVDA approval is pre-signing historical; Investors headers will be extended before any real contribution is recorded).
- 2026-07-07T22:35:00.622Z — id=d3fa3417-66f8-49fa-a3bb-83cbe044ef71 — executor must refuse this; find out how it got approved unsigned
- 2026-07-09T22:35:01.079Z — id=d3fa3417-66f8-49fa-a3bb-83cbe044ef71 — executor must refuse this; find out how it got approved unsigned
- 2026-07-10T22:35:00.519Z — id=d3fa3417-66f8-49fa-a3bb-83cbe044ef71 — executor must refuse this; find out how it got approved unsigned

## Resolution

Resolved on 2026-07-14 through the audited historical-artifact path: the retained
pre-signing routing-test approval was converted to rejected/non-executable with a
signed attestation. A fresh production query found zero unsigned
`ApprovedForBrokerReview` proposals. The historical row remains preserved.
