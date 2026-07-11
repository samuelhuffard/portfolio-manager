---
id: F-2026-024
fingerprint: bc444110fc35
check: logs
type: infra
severity: P2
status: open
firstSeen: 2026-07-07T22:35:00.622Z
lastSeen: 2026-07-07T22:35:00.622Z
occurrences: 1
title: "New error cluster in PM2 logs"
---

# New error cluster in PM2 logs

**Check:** logs · **Severity:** P2

## Evidence

- 2026-07-07T22:35:00.622Z — 1× "[Research] agent-1: NVDA failed mid-review (continuing): 400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified "

## Analyst note (2026-07-07)

jobs/research-scan.js:980 logs per-ticker failures with the comment noting this is deliberately non-fatal (Anthropic 429/timeout, Yahoo hiccup, EDGAR outage) so one ticker's failure doesn't drop the whole run; the truncated message ('reached your specified...') strongly suggests an Anthropic API rate/usage-limit was hit repeatedly across ~2 dozen tickers in one run (F-2026-024 through 053), degrading those tickers to fallback recommendations.

**Next step:** Pull the full untruncated error message from PM2 logs to confirm whether this is a per-key rate limit or a hard spend cap, and check whether research-scan's concurrency/pacing needs throttling to avoid mass ticker failures in a single run.
