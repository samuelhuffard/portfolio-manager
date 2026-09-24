# Handoff

## Goal

Make Portfolio Manager agents actively generate evidence-backed, human-approved trade proposals when warranted, while preserving the signed-approval/order boundary.

## Current State

Production backend is Jetson `/home/sam/portfolio-manager`, branch `mandate-v3`, deployed commit `399693e`. `portfolio-manager` is healthy; PM2 restart edge was 5→6. `PEER_FUNDAMENTAL_PROPOSAL_CANARY_SLOTS=1` is live. It grants at most one peer-screened research candidate per scheduled scan **per agent** permission to reach the normal proposal path. It never executes orders; Sam remains the sole approver.

The first live canary scan completed cleanly: Agent 1/2/3 reviewed 3/4/1 names; all eight were HOLD, with zero proposals, evaluator rejects, errors, or budget exhaustions. This is a valid first observation, not evidence that the canary failed.

## Files in Flight

- `jobs/research-scan.js` — applies the scheduled per-agent canary; manual Lab remains HOLD-only.
- `lib/peer-fundamental-proposal-canary.js` — fail-closed one-slot token plus peer-screen policy.
- `tests/peer-fundamental-proposal-canary.test.js` — asserts `[true, false, false]` for three candidates in one scan.

## Changed

`399693e Allow one peer-screened research proposal per agent` was independently reviewed, pushed, tested (1027/1027), and deployed. Earlier candidate-dossier shadow/JSONB fixes are also deployed; dossier readiness remains intentionally zero because upstream observations are incomplete.

## Failed Attempts

- The old peer-fundamental context had `researchOnly: true`, which forced HOLD despite ordinary proposal authority.
- Do not flip canonical `observation.actionable`: live observations lack several mandate-critical metrics, so that would either produce none or falsely label incomplete data trade-ready.
- Do not use manual Lab to test the canary; it is intentionally hardcoded HOLD-only to prevent bypassing the scheduled budget.
- Do not work from the stale, dirty Mac primary checkout. Use `/private/tmp/portfolio-manager-peer-actionability` or make a fresh worktree from current `origin/mandate-v3`.

## Next Step

After the next five trading-day scheduled scans, inspect aggregate durable scan outcomes per agent (attempted reviews, BUY/SELL/HOLD, proposal-created, evaluator reject, data/risk/duplicate blocks). Identify the dominant remaining blocker to a legitimate proposal and improve only that upstream research/proposal gate; do not relax evidence, evaluator, signature, broker, ledger, or execution safeguards.
