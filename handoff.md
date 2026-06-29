# Handoff

## Goal
Estimate the weekly Claude API cost (in API credits) for the portfolio-manager project.

## Current State
Mid-analysis. Read the scheduler and several support files but have NOT yet read the actual AI-calling job files. No cost estimate produced yet.

## Files in Flight
None — read-only analysis session, no edits made.

## What I Read
- `scheduler.js` — full job schedule documented below
- `jobs/holdings-sync.js` — confirmed NO Claude API calls, pure data sync
- `lib/redis.js` — no Claude API calls
- `server.js` — no Claude API calls

## Schedule (weekdays only, 5 days/week)
- `runPremarketCheck()` — 8:30 AM ET × 1/day
- `runIntradayMonitor({ context: "opening" })` — 9:35 AM × 1/day
- `runIntradayMonitor({ context: "intraday" })` — every 30 min 10AM–3:30PM ≈ 12 runs/day
- `runIntradayMonitor({ context: "pre-close" })` — 3:50 PM × 1/day
- `runExitMonitor()` — 4:45 PM × 1/day
- `runResearchScan({ agentIds: ["agent-1"] })` — 5:15 PM × 1/day
- `runPerformanceReview()` — 5:45 PM × 1/day

Total intraday runs/day: ~14 | Total daily AI-calling jobs: ~18 | Weekly: ~90 runs

## Next Step
Read the five AI-calling job files to find which Claude model they use and estimate input/output token counts per call, then compute weekly cost:

1. `jobs/premarket-check.js`
2. `jobs/intraday-monitor.js`
3. `jobs/monitor-positions.js`
4. `jobs/research-scan.js`
5. `jobs/performance-review.js`

Current Claude pricing: Opus 4.8 = $5/1M input + $25/1M output; Sonnet 4.6 = $3/$15; Haiku 4.5 = $1/$5.
